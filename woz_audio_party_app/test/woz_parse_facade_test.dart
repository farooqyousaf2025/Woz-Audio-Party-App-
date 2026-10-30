import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:woz_audio_party_app/woz_parse/parse_server_sdk.dart';

// Exercises the Parse facade against a running woz_backend.
// Start the backend first, then: flutter test test/woz_parse_facade_test.dart
const String apiBase =
    String.fromEnvironment('WOZ_API', defaultValue: 'http://127.0.0.1:8090/api');
const String liveBase =
    String.fromEnvironment('WOZ_LIVE', defaultValue: 'http://127.0.0.1:8090');

void main() {
  final String suite = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
  late String username;
  late ParseUser user;

  setUpAll(() async {
    await Parse().initialize(
      'facade-test',
      apiBase,
      liveQueryUrl: liveBase,
      coreStore: CoreStoreMemoryImp(),
      autoSendSessionId: true,
    );
    username = 'facade_$suite';
    user = ParseUser(username, 'secret123', '$suite@woz.local');
    final ParseResponse signed = await user.signUp();
    expect(signed.success, isTrue, reason: '${signed.error?.message}');
  });

  test('signUp returns a usable session token', () async {
    expect(user.sessionToken, isNotNull);
    final ParseResponse? me = await ParseUser.getCurrentUserFromServer(user.sessionToken!);
    expect(me?.success, isTrue, reason: '${me?.error?.message}');
    expect((me?.result as ParseUser).username, username);
  });

  test('object create, fetch and update round-trip json types', () async {
    final ParseObject post = ParseObject('Posts')
      ..set<String>('suite', suite)
      ..set<String>('title', 'first post')
      ..set<int>('likes', 2)
      ..set<bool>('published', true)
      ..set<List<String>>('tags', <String>['hot'])
      ..set<Map<String, dynamic>>(
          'author', <String, dynamic>{'name': 'Alpha', 'vip': false});

    final ParseResponse saved = await post.save();
    expect(saved.success, isTrue, reason: '${saved.error?.message}');
    expect(post.objectId, isNotNull);

    final ParseObject reloaded =
        (await post.getObject(post.objectId!)).result as ParseObject;
    expect(reloaded.get<int>('likes'), 2);
    expect(reloaded.get<bool>('published'), isTrue);
    expect(reloaded.get<List<String>>('tags'), <String>['hot']);
    expect(reloaded.get<Map<String, dynamic>>('author')!['name'], 'Alpha');
    expect(reloaded.createdAt, isNotNull);

    reloaded.setIncrement('likes', 5);
    reloaded.set<String>('title', 'edited');
    final ParseResponse updated = await reloaded.save();
    expect(updated.success, isTrue, reason: '${updated.error?.message}');

    final ParseObject after =
        (await post.getObject(post.objectId!)).result as ParseObject;
    expect(after.get<int>('likes'), 7);
    expect(after.get<String>('title'), 'edited');
  });

  test('queryBuilder filters, orders, counts and deletes', () async {
    for (int i = 0; i < 4; i += 1) {
      await (ParseObject('Posts')
            ..set<String>('suite', suite)
            ..set<String>('title', 'row $i')
            ..set<int>('rank', i))
          .save();
    }
    await (ParseObject('Posts')
          ..set<String>('suite', suite)
          ..set<String>('title', 'start anchor')
          ..set<int>('rank', 0))
        .save();

    final QueryBuilder<ParseObject> high = QueryBuilder<ParseObject>(ParseObject('Posts'))
      ..whereEqualTo('suite', suite)
      ..whereGreaterThan('rank', 1)
      ..orderByDescending('rank')
      ..setLimit(10);

    final List<ParseObject> found = await high.find();
    expect(found.length, 2);
    expect(found.first.get<int>('rank'), 3);

    expect((await high.count()).count, 2);

    final QueryBuilder<ParseObject> contains =
        QueryBuilder<ParseObject>(ParseObject('Posts'))
          ..whereEqualTo('suite', suite)
          ..whereContains('title', 'row 2');
    final List<ParseObject> one = await contains.find();
    expect(one.length, 1);

    final QueryBuilder<ParseObject> starts =
        QueryBuilder<ParseObject>(ParseObject('Posts'))
          ..whereEqualTo('suite', suite)
          ..whereStartsWith('title', 'start');
    expect((await starts.find()).length, 1);

    final ParseObject doomed = one.first;
    final ParseResponse removed = await doomed.delete<ParseObject>();
    expect(removed.success, isTrue, reason: '${removed.error?.message}');
    final ParseResponse gone = await doomed.getObject(doomed.objectId!);
    expect(gone.error?.code, ParseError.objectNotFound);
  });

  test('or and and contained-in lists', () async {
    final QueryBuilder<ParseObject> inner =
        QueryBuilder<ParseObject>(ParseObject('Posts'))
          ..whereEqualTo('suite', suite)
          ..whereEqualTo('title', 'row 1');
    final QueryBuilder<ParseObject> other =
        QueryBuilder<ParseObject>(ParseObject('Posts'))
          ..whereEqualTo('suite', suite)
          ..whereEqualTo('title', 'row 3');
    final QueryBuilder<ParseObject> either =
        QueryBuilder<ParseObject>.or(ParseObject('Posts'), <QueryBuilder<ParseObject>>[
      inner,
      other,
    ]);
    expect((await either.find()).length, 2);

    final QueryBuilder<ParseObject> listed =
        QueryBuilder<ParseObject>(ParseObject('Posts'))
          ..whereEqualTo('suite', suite)
          ..whereContainedIn('title', <String>['row 0', 'edited']);
    expect((await listed.find()).length, 2);
  });

  test('cloud function, config and file upload', () async {
    final ParseResponse phone =
        await ParseCloudFunction('check_phone_number').execute(
            parameters: <String, dynamic>{'phone_number': '+10000000000'});
    expect(phone.success, isTrue, reason: '${phone.error?.message}');
    expect((phone.result as Map)['exists'], false);

    final ParseResponse config = await ParseConfig().getConfigs();
    expect(config.success, isTrue, reason: '${config.error?.message}');

    final ParseWebFile file = ParseWebFile(
      Uint8List.fromList(<int>[1, 2, 3, 4, 5]),
      name: 'facade_$suite.png',
    );
    final ParseResponse uploaded = await file.save();
    expect(uploaded.success, isTrue, reason: '${uploaded.error?.message}');
    expect(file.url, startsWith('$liveBase/uploads/'));
    expect(file.url, endsWith('.png'));
  });

  test('live query delivers create and update events', () async {
    final QueryBuilder<ParseObject> query =
        QueryBuilder<ParseObject>(ParseObject('Posts'))
          ..whereEqualTo('suite', suite)
          ..whereEqualTo('title', 'live watch');

    final ParseLiveList<ParseObject> live = await ParseLiveList.create<ParseObject>(
      query,
      lazyLoading: false,
    );

    final List<ParseLiveListEvent<ParseObject>> events =
        <ParseLiveListEvent<ParseObject>>[];
    final StreamSubscription<ParseLiveListEvent<ParseObject>> sub =
        live.stream.listen(events.add);

    final ParseObject watched = ParseObject('Posts')
      ..set<String>('suite', suite)
      ..set<String>('title', 'live watch')
      ..set<int>('rank', 99);
    await watched.save();
    await Future<void>.delayed(const Duration(milliseconds: 400));
    watched.set<String>('caption', 'touched');
    await watched.save();

    final DateTime deadline = DateTime.now().add(const Duration(seconds: 15));
    bool sawCreate = false;
    bool sawUpdate = false;
    while (DateTime.now().isBefore(deadline) && !(sawCreate && sawUpdate)) {
      sawCreate = events.any((ParseLiveListEvent<ParseObject> e) =>
          e is ParseLiveListAddEvent<ParseObject> && e.object.objectId == watched.objectId);
      sawUpdate = events.any((ParseLiveListEvent<ParseObject> e) =>
          e is ParseLiveListUpdateEvent<ParseObject> &&
          e.object.objectId == watched.objectId &&
          e.object.get<String>('caption') == 'touched');
      if (sawCreate && sawUpdate) break;
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }

    await sub.cancel();
    live.dispose();
    expect(sawCreate, isTrue, reason: 'events: ${events.map((e) => e.runtimeType).toList()}');
    expect(sawUpdate, isTrue, reason: 'events: ${events.map((e) => e.runtimeType).toList()}');
  });

  test('logout invalidates the stored session', () async {
    final ParseResponse out = await user.logout();
    expect(out.success, isTrue, reason: '${out.error?.message}');
    expect(ParseCoreData.instance.sessionId, isNull);
    expect(await ParseUser.currentUser(), isNull);
  });
}
