part of woz_parse;

enum LiveQueryEvent { create, enter, update, leave, delete, error }

enum LiveQueryClientEvent { connected, disconnected, userDisconnected }

/// Entry point kept for source compatibility: `LiveQuery().client.subscribe(...)`.
class LiveQuery {
  LiveQuery({bool? debug, bool? autoSendSessionId}) {
    client = LiveQueryClient.instance;
  }

  late LiveQueryClient client;
}

class Subscription<T extends ParseObject> {
  Subscription(this.query, this.requestId);

  final QueryBuilder<T> query;
  final Object requestId;
  String? subscriptionId;
  final Map<LiveQueryEvent, Function> _handlers = <LiveQueryEvent, Function>{};

  void on(LiveQueryEvent op, Function callback) {
    _handlers[op] = callback;
  }

  void dispatch(LiveQueryEvent op, dynamic object) {
    final Function? handler = _handlers[op];
    if (handler == null) return;
    try {
      (handler as dynamic)(object);
    } on TypeError {
      // The handler declared a concrete subclass the payload could not satisfy;
      // dropping the frame matches the previous SDK behaviour of ignoring it.
    }
  }
}

/// Keeps one WebSocket to the backend `/ws` endpoint and routes live events to
/// subscriptions. Reconnects with backoff and replays outstanding subscriptions.
class LiveQueryClient {
  LiveQueryClient._();

  static final LiveQueryClient _instance = LiveQueryClient._();

  static LiveQueryClient get instance => _instance;

  final Map<Object, Subscription<ParseObject>> _subscriptions =
      <Object, Subscription<ParseObject>>{};
  final StreamController<LiveQueryClientEvent> _events =
      StreamController<LiveQueryClientEvent>.broadcast();
  final StreamController<String> _frames = StreamController<String>.broadcast();

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _channelSubscription;
  bool _connecting = false;
  int _attempt = 0;
  Timer? _retryTimer;
  int _nextRequestId = 1;

  Stream<LiveQueryClientEvent> get getClientEventStream => _events.stream;

  Stream<String> get chanelStream => _frames.stream;

  int readyState() => _channel == null ? 3 : 1;

  String get _url {
    final String? configured = ParseCoreData.instance.liveQueryURL;
    final String raw = configured == null || configured.isEmpty
        ? ParseCoreData.instance.serverUrl
        : configured;
    final Uri parsed = Uri.parse(raw);
    final String scheme = switch (parsed.scheme) {
      'https' || 'wss' => 'wss',
      _ => 'ws',
    };
    final bool hasPath = parsed.path.isNotEmpty && parsed.path != '/';
    return '$scheme://${parsed.authority}${hasPath ? parsed.path : '/ws'}';
  }

  Future<void> reconnect({bool userInitialized = false}) async {
    if (_connecting || _channel != null) return;
    _connecting = true;
    final String? token = ParseCoreData.instance.sessionId;
    final Uri uri = Uri.parse(_url)
        .replace(queryParameters: token == null ? null : <String, String>{'token': token});
    try {
      final WebSocketChannel channel = WebSocketChannel.connect(uri);
      await channel.ready.timeout(const Duration(seconds: 10));
      _channel = channel;
      _connecting = false;
      _attempt = 0;
      _channelSubscription = channel.stream.listen(_onFrame, onDone: _onClosed, onError: (_) => _onClosed());
      _events.add(LiveQueryClientEvent.connected);
      for (final Subscription<ParseObject> subscription in _subscriptions.values) {
        _sendSubscribe(subscription);
      }
    } catch (_) {
      _connecting = false;
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    _retryTimer?.cancel();
    _attempt += 1;
    final int seconds = <int>[1, 2, 5, 10, 30][(_attempt - 1).clamp(0, 4)];
    _retryTimer = Timer(Duration(seconds: seconds), () => reconnect());
  }

  void _onClosed() {
    _channelSubscription?.cancel();
    _channel = null;
    _events.add(LiveQueryClientEvent.disconnected);
    _scheduleReconnect();
  }

  void _onFrame(dynamic raw) {
    if (raw is! String) return;
    _frames.add(raw);
    Map<String, dynamic> message;
    try {
      message = Map<String, dynamic>.from(jsonDecode(raw) as Map);
    } on FormatException {
      return;
    }
    if (message['type'] != 'live') return;

    final String action = message['action'] as String? ?? '';
    if (action == 'subscribed') {
      final Subscription<ParseObject>? subscription =
          _subscriptions[message['requestId'] as Object?];
      if (subscription != null) {
        subscription.subscriptionId = message['subscriptionId'] as String?;
      }
      return;
    }
    if (action == 'error') {
      _events.add(LiveQueryClientEvent.disconnected);
      return;
    }
    final String? subscriptionId = message['subscriptionId'] as String?;
    if (subscriptionId == null) return;
    Subscription<ParseObject>? subscription;
    for (final Subscription<ParseObject> candidate in _subscriptions.values) {
      if (candidate.subscriptionId == subscriptionId) {
        subscription = candidate;
        break;
      }
    }
    if (subscription == null) return;

    final LiveQueryEvent? event = <String, LiveQueryEvent>{
      'create': LiveQueryEvent.create,
      'enter': LiveQueryEvent.enter,
      'update': LiveQueryEvent.update,
      'leave': LiveQueryEvent.leave,
      'delete': LiveQueryEvent.delete,
    }[action];
    if (event == null) return;

    final dynamic object = message['object'];
    if (object is Map) {
      subscription.dispatch(
          event,
          parseDecode(<String, dynamic>{
            'className': message['className'] ?? object['className'],
            ...Map<String, dynamic>.from(object),
          }));
    } else {
      subscription.dispatch(event, message);
    }
  }

  Future<Subscription<T>> subscribe<T extends ParseObject>(QueryBuilder<T> query,
      {T? copyObject}) async {
    final Subscription<T> subscription =
        Subscription<T>(query, _nextRequestId++);
    _subscriptionAdd(subscription);
    if (_channel == null) {
      await reconnect();
    }
    _sendSubscribe<T>(subscription);
    return subscription;
  }

  void _subscriptionAdd(Subscription<ParseObject> subscription) {
    _subscriptions[subscription.requestId] = subscription;
  }

  void _sendSubscribe<T extends ParseObject>(Subscription<T> subscription) {
    final Map<String, dynamic> payload = <String, dynamic>{
      'type': 'live',
      'action': 'subscribe',
      'requestId': subscription.requestId,
      'className': subscription.query.object.parseClassName,
      'where': subscription.query.conditions,
      if (subscription.query.limiters['include'] != null)
        'include': (subscription.query.limiters['include'] as String).split(','),
    };
    try {
      _channel?.sink.add(jsonEncode(payload));
    } catch (_) {
      _channel = null;
      reconnect();
    }
  }

  void unSubscribe<T extends ParseObject>(Subscription<T> subscription) {
    _subscriptions.remove(subscription.requestId);
    if (subscription.subscriptionId != null) {
      try {
        _channel?.sink.add(jsonEncode(<String, dynamic>{
          'type': 'live',
          'action': 'unsubscribe',
          'subscriptionId': subscription.subscriptionId,
        }));
      } catch (_) {
        // The socket is gone; the server drops subscriptions on close anyway.
      }
    }
  }

  Future<void> disconnect({bool userInitialized = false}) async {
    _retryTimer?.cancel();
    await _channel?.sink.close();
    _channel = null;
    _connecting = false;
    _events.add(LiveQueryClientEvent.userDisconnected);
  }
}

abstract class ParseLiveListEvent<T extends ParseObject> {
  ParseLiveListEvent(this.index, this.object);

  final int index;
  final T object;
}

class ParseLiveListAddEvent<T extends ParseObject> extends ParseLiveListEvent<T> {
  ParseLiveListAddEvent(int index, T object) : super(index, object);
}

class ParseLiveListUpdateEvent<T extends ParseObject> extends ParseLiveListEvent<T> {
  ParseLiveListUpdateEvent(int index, T object) : super(index, object);
}

class ParseLiveListDeleteEvent<T extends ParseObject> extends ParseLiveListEvent<T> {
  ParseLiveListDeleteEvent(int index, T object) : super(index, object);
}

class ParseLiveListElementSnapshot<T extends ParseObject> {
  ParseLiveListElementSnapshot({this.loadedData, this.error, this.preLoadedData});

  final T? loadedData;
  final T? preLoadedData;
  final ParseError? error;

  bool get hasData => loadedData != null;

  bool get hasPreLoadedData => preLoadedData != null;

  bool get failed => error != null;
}

class ParseLiveListElement<T extends ParseObject> {
  ParseLiveListElement(T object, {bool loaded = false})
      : _object = object,
        _loaded = loaded {
    _controller = StreamController<T>.broadcast();
  }

  T _object;
  bool _loaded;
  late final StreamController<T> _controller;

  T get object => _object;

  set object(T value) {
    _object = value;
    _loaded = true;
    if (!_controller.isClosed) _controller.add(value);
  }

  bool get loaded => _loaded;

  Stream<T> get stream => _controller.stream;

  void dispose() {
    _controller.close();
  }
}

class ParseLiveElement<T extends ParseObject> extends ParseLiveListElement<T> {
  ParseLiveElement(T object, {bool loaded = false, List<String>? includeObject})
      : super(object, loaded: loaded) {
    queryBuilder = QueryBuilder<T>(object)
      ..includeObject(includeObject ?? <String>[]);
  }

  late QueryBuilder<T> queryBuilder;

  Future<void> reconnected() async {
    final String? id = _object.objectId;
    if (id == null) return;
    final ParseResponse response = await _object.getObject(id);
    if (response.success && response.results != null && response.results!.isNotEmpty) {
      object = response.results!.first as T;
    }
  }
}

/// A live, ordered collection backed by one REST page plus one subscription.
class ParseLiveList<T extends ParseObject> {
  ParseLiveList._(this._query, this._lazyLoading, this._listeningIncludes);

  static Future<ParseLiveList<T>> create<T extends ParseObject>(
    QueryBuilder<T> query, {
    bool? listenOnAllSubItems,
    List<String>? listeningIncludes,
    bool lazyLoading = true,
    List<String>? preloadedColumns,
  }) async {
    final ParseLiveList<T> list =
        ParseLiveList<T>._(query, lazyLoading, listeningIncludes);
    await list._initialLoad(preloadedColumns);
    await list._startSubscription();
    return list;
  }

  final QueryBuilder<T> _query;
  final bool _lazyLoading;
  final List<String>? _listeningIncludes;

  final List<ParseLiveListElement<T>> _elements = <ParseLiveListElement<T>>[];
  final StreamController<ParseLiveListEvent<T>> _controller =
      StreamController<ParseLiveListEvent<T>>.broadcast();
  Subscription<T>? _subscription;
  StreamSubscription<LiveQueryClientEvent>? _clientEvents;

  Stream<ParseLiveListEvent<T>> get stream => _controller.stream;

  int get size => _elements.length;

  List<String> get includes =>
      (_query.limiters['include'] as String?)?.split(',') ?? <String>[];

  int get nextID => _elements.length;

  bool? after(T object1, T object2) {
    final int i = _elements.indexWhere((ParseLiveListElement<T> e) => e.object == object1);
    final int j = _elements.indexWhere((ParseLiveListElement<T> e) => e.object == object2);
    if (i == -1 || j == -1) return null;
    return i > j;
  }

  String idOf(int index) => _elements[index].object.objectId ?? 'NotFound';

  String getIdentifier(int index) =>
      '${idOf(index)}${_elements[index].object.updatedAt}';

  T? getLoadedAt(int index) =>
      _elements[index].loaded ? _elements[index].object : null;

  T? getPreLoadedAt(int index) => _elements[index].object;

  Stream<T> getAt(int index) async* {
    if (index < 0 || index >= _elements.length) return;
    final ParseLiveListElement<T> element = _elements[index];
    yield element.object;
    if (!_lazyLoading || element.loaded) return;
    final T? full = await _fetchFull(element.object);
    if (full != null && index < _elements.length &&
        _elements[index].object.objectId == element.object.objectId) {
      _elements[index].object = full;
      yield full;
    }
  }

  Future<T?> _fetchFull(T object) async {
    final String? id = object.objectId;
    if (id == null) return object;
    final ParseResponse response =
        await object.getObject(id, include: _listeningIncludes);
    if (response.success && response.results != null && response.results!.isNotEmpty) {
      return response.results!.first as T;
    }
    return object;
  }

  Future<void> _initialLoad(List<String>? preloadedColumns) async {
    final QueryBuilder<T> page = QueryBuilder.copy<T>(_query);
    if (_lazyLoading) {
      final List<String> keys = <String>[
        ...?preloadedColumns,
        ...includes,
      ];
      final String? order = page.limiters['order'] as String?;
      if (order != null) {
        keys.addAll(order.split(',').map((String key) => key.replaceAll('-', '')));
      }
      if (keys.isNotEmpty) page.keysToReturn(keys.toSet().toList());
    }
    final ParseResponse response = await page.query<T>();
    if (response.success && response.results != null) {
      for (final dynamic result in response.results!) {
        if (result is T) {
          _elements.add(ParseLiveListElement<T>(result, loaded: !_lazyLoading));
        }
      }
    }
  }

  Future<void> _startSubscription() async {
    _subscription = await LiveQueryClient.instance.subscribe<T>(_query);
    _subscription!.on(LiveQueryEvent.create, _handleAdd);
    _subscription!.on(LiveQueryEvent.enter, _handleAdd);
    _subscription!.on(LiveQueryEvent.update, _handleUpdate);
    _subscription!.on(LiveQueryEvent.leave, _handleRemove);
    _subscription!.on(LiveQueryEvent.delete, _handleRemove);
    _clientEvents = LiveQueryClient.instance.getClientEventStream.listen(
        (LiveQueryClientEvent event) async {
      if (event != LiveQueryClientEvent.connected) return;
      await _reloadInPlace();
    });
  }

  /// Re-runs the query after a reconnect and reconciles by objectId + updatedAt
  /// so a dropped frame never leaves the list stale.
  Future<void> _reloadInPlace() async {
    final QueryBuilder<T> page = QueryBuilder.copy<T>(_query);
    final ParseResponse response = await page.query<T>();
    if (!response.success || response.results == null) return;
    final Map<String, T> incoming = <String, T>{
      for (final dynamic result in response.results!)
        if (result is T && result.objectId != null) result.objectId!: result
    };

    for (int i = _elements.length - 1; i >= 0; i--) {
      final String id = idOf(i);
      final T? match = incoming.remove(id);
      if (match == null) {
        final T removed = _elements.removeAt(i).object;
        _controller.add(ParseLiveListDeleteEvent<T>(i, removed));
      } else if (match.updatedAt != _elements[i].object.updatedAt) {
        _elements[i].object = match;
        _controller.add(ParseLiveListUpdateEvent<T>(i, match));
      }
    }
    int index = _elements.length;
    for (final T object in incoming.values) {
      _elements.add(ParseLiveListElement<T>(object, loaded: !_lazyLoading));
      _controller.add(ParseLiveListAddEvent<T>(index, object));
      index += 1;
    }
  }

  void _handleAdd(dynamic object) {
    if (object is! T) return;
    final int existing = _elements.indexWhere(
        (ParseLiveListElement<T> e) => e.object.objectId == object.objectId);
    if (existing != -1) {
      _elements[existing].object = object;
      _controller.add(ParseLiveListUpdateEvent<T>(existing, object));
      return;
    }
    _elements.add(ParseLiveListElement<T>(object, loaded: !_lazyLoading));
    _controller.add(ParseLiveListAddEvent<T>(_elements.length - 1, object));
  }

  void _handleUpdate(dynamic object) {
    if (object is! T) return;
    final int index = _elements.indexWhere(
        (ParseLiveListElement<T> e) => e.object.objectId == object.objectId);
    if (index == -1) {
      _handleAdd(object);
      return;
    }
    _elements[index].object = object;
    _controller.add(ParseLiveListUpdateEvent<T>(index, object));
  }

  void _handleRemove(dynamic object) {
    if (object is! T) return;
    final int index = _elements.indexWhere(
        (ParseLiveListElement<T> e) => e.object.objectId == object.objectId);
    if (index == -1) return;
    _elements.removeAt(index).dispose();
    _controller.add(ParseLiveListDeleteEvent<T>(index, object));
  }

  void dispose() {
    _clientEvents?.cancel();
    final Subscription<T>? subscription = _subscription;
    if (subscription != null) {
      LiveQueryClient.instance.unSubscribe<T>(subscription);
    }
    for (final ParseLiveListElement<T> element in _elements) {
      element.dispose();
    }
    _elements.clear();
    _controller.close();
  }
}
