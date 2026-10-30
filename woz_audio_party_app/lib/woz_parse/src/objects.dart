part of woz_parse;

class ParseGeoPoint {
  ParseGeoPoint({this.latitude = 0.0, this.longitude = 0.0})
      : assert(latitude <= 90 && latitude >= -90,
            'Latitude must be within the range (-90.0, 90.0).'),
        assert(longitude <= 180 && longitude >= -180,
            'Longitude must be within the range (-180.0, 180.0).');

  double latitude, longitude;

  Map<String, dynamic> toJson({bool full = false, bool forApiRQ = false}) =>
      <String, dynamic>{
        '__type': 'GeoPoint',
        'latitude': latitude,
        'longitude': longitude
      };

  @override
  String toString() => 'latitude: $latitude, longitude: $longitude';
}

class ParseACL {
  ParseACL({bool publicRead = false, bool publicWrite = false}) {
    if (publicRead) _permissions['*'] = <String, dynamic>{'read': true};
    if (publicWrite) {
      _permissions['*'] = <String, dynamic>{'write': true};
    }
  }

  final Map<String, dynamic> _permissions = <String, dynamic>{};

  void setPublicReadAccess(bool allowed) =>
      (_permissions['*'] ??= <String, dynamic>{})['read'] = allowed;

  void setPublicWriteAccess(bool allowed) =>
      (_permissions['*'] ??= <String, dynamic>{})['write'] = allowed;

  void setReadAccess(String userId, bool allowed) =>
      (_permissions[userId] ??= <String, dynamic>{})['read'] = allowed;

  void setWriteAccess(String userId, bool allowed) =>
      (_permissions[userId] ??= <String, dynamic>{})['write'] = allowed;

  bool getPublicReadAccess() => (_permissions['*']?['read'] ?? false) as bool;

  bool getPublicWriteAccess() => (_permissions['*']?['write'] ?? false) as bool;

  ParseACL fromJson(dynamic json) {
    _permissions
      ..clear()
      ..addAll(Map<String, dynamic>.from((json ?? <String, dynamic>{}) as Map));
    return this;
  }

  Map<String, dynamic> toJson() => Map<String, dynamic>.from(_permissions);
}

class ParseRelation<T extends ParseObject> {
  ParseRelation([ParseObject? parent, String? key]) {
    this.parent = parent;
    this.key = key;
  }

  ParseObject? parent;
  String? key;
  String? targetClass;
  final List<T> _knownObjects = <T>[];

  void attach(ParseObject parent, String key) {
    this.parent = parent;
    this.key = key;
  }

  static ParseRelation<T> fromJson<T extends ParseObject>(Map<String, dynamic> map) {
    final ParseRelation<T> relation = ParseRelation<T>()
      ..targetClass = map['className'] as String?;
    return relation;
  }

  void add(T object) {
    _knownObjects.add(object);
    parent?.setOperation(
        key ?? '', _AddOperation(key ?? '', <dynamic>[object]));
  }

  void remove(T object) {
    _knownObjects.remove(object);
    parent?.setOperation(
        key ?? '', _RemoveOperation(key ?? '', <dynamic>[object]));
  }

  QueryBuilder<T> get query {
    final ParseObject target = targetClass == null
        ? ParseObject('Unknown')
        : ParseCoreData.instance.createObject(targetClass!);
    return QueryBuilder<T>(target as T)
      .._where = <String, dynamic>{
        r'$relatedTo': <String, dynamic>{
          'object': parent?.toPointer(),
          'key': key,
        }
      };
  }

  Map<String, dynamic> toJson({bool full = false, bool forApiRQ = false}) =>
      <String, dynamic>{
        '__type': 'Relation',
        'className': targetClass ??
            (_knownObjects.isNotEmpty ? _knownObjects.first.parseClassName : '')
      };
}

abstract class ParseFileBase extends ParseObject {
  ParseFileBase(
      {required String name,
      String? url,
      bool? debug,
      dynamic client,
      bool? autoSendSessionId})
      : super(keyFileClassname,
            debug: debug,
            autoSendSessionId: autoSendSessionId,
            client: client) {
    this.name = name;
    if (url != null) this.url = url;
  }

  String get name => super.get<String>(keyVarName)!;

  set name(String name) => set<String>(keyVarName, name);

  String? get url => super.get<String>(keyVarURL);

  set url(String? url) => set<String?>(keyVarURL, url);

  bool get saved => url != null;

  CancelToken? _cancelToken;
  ProgressCallback? _progressCallback;

  @override
  Map<String, dynamic> toJson({
    bool full = false,
    bool forApiRQ = false,
    bool allowCustomObjectId = false,
  }) =>
      <String, dynamic>{
        '__type': keyFile,
        'name': name,
        'url': url,
        if (objectId != null) keyVarObjectId: objectId,
      };

  static const String keyFile = 'File';

  @override
  String toString() => json.encode(toJson(full: true));

  @override
  Future<ParseResponse> save({dynamic context}) => upload();

  Future<ParseResponse> upload({ProgressCallback? progressCallback});

  Future<ParseFileBase> download({ProgressCallback? progressCallback});

  /// Uploads raw bytes as multipart form data, which is what the backend's
  /// `/api/files` endpoint expects.
  Future<ParseNetworkResponse> postFileBytes(
      List<int> bytes, String filename, ProgressCallback? progressCallback) {
    final FormData form = FormData();
    form.files.add(MapEntry(
      'file',
      MultipartFile.fromBytes(bytes, filename: filename),
    ));
    return WozRest().send('POST', '/files',
        data: form,
        onSendProgress: progressCallback ?? _progressCallback,
        cancelToken: _cancelToken);
  }

  ParseResponse finishUpload(ParseNetworkResponse response) {
    final ParseResponse parsed =
        handleResponse<ParseFileBase>(this, response, ParseApiRQ.upload);
    if (parsed.success && response.data.isNotEmpty) {
      final Map<String, dynamic> map =
          Map<String, dynamic>.from(jsonDecode(response.data) as Map);
      url = absoluteFileUrl(map['url'] as String?);
      name = (map['name'] as String?) ?? name;
      if (map[keyVarObjectId] != null) objectId = map[keyVarObjectId] as String;
      if (map[keyVarCreatedAt] != null) {
        createdAt = parseParseDate(map[keyVarCreatedAt]);
      }
    }
    parsed.result = this;
    parsed.results = <dynamic>[this];
    return parsed;
  }

  void progressCallback(ProgressCallback progressCallback) {
    _progressCallback = progressCallback;
  }

  void cancel([dynamic reason]) {
    _cancelToken?.cancel(reason);
    _cancelToken = null;
  }
}

class ParseFile extends ParseFileBase {
  ParseFile(this.file,
      {String? name,
      String? url,
      bool? debug,
      dynamic client,
      bool? autoSendSessionId})
      : super(
          name: file != null ? _basename(file.path) : (name ?? ''),
          url: url,
          debug: debug,
          client: client,
          autoSendSessionId: autoSendSessionId,
        );

  File? file;

  Future<ParseFile> loadStorage() async {
    final File possibleFile = File('${Directory.systemTemp.path}/$name');
    file = (await possibleFile.exists()) ? possibleFile : null;
    return this;
  }

  @override
  Future<ParseFile> download({ProgressCallback? progressCallback}) async {
    if (url == null) return this;
    try {
      final ParseNetworkResponse response = await WozRest(sendSessionId: false)
          .get(url!,
              byteResponse: true,
              onReceiveProgress: progressCallback ?? _progressCallback,
              cancelToken: _cancelToken);
      final File target = File('${Directory.systemTemp.path}/$name');
      await target.writeAsBytes(response.bytes ?? <int>[], flush: true);
      file = target;
    } on Exception {
      // A missing local copy is not an error for callers that only display url.
    }
    return this;
  }

  @override
  Future<ParseResponse> upload({ProgressCallback? progressCallback}) async {
    if (saved) {
      return ParseResponse()
        ..success = true
        ..statusCode = 201
        ..result = <String, String>{'url': url!, 'name': name}
        ..results = <dynamic>[this];
    }
    final File? source = file;
    if (source == null) {
      return ParseResponse()
        ..error = ParseError(
            code: ParseError.otherCause, message: 'No file to upload');
    }
    try {
      final List<int> bytes = await source.readAsBytes();
      final ParseNetworkResponse response =
          await postFileBytes(bytes, _basename(source.path), progressCallback);
      return finishUpload(response);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.upload, _debug, parseClassName);
    }
  }
}

class ParseWebFile extends ParseFileBase {
  ParseWebFile(this.file,
      {required String name,
      String? url,
      bool? debug,
      dynamic client,
      bool? autoSendSessionId})
      : super(
          name: name,
          url: url,
          debug: debug,
          client: client,
          autoSendSessionId: autoSendSessionId,
        );

  Uint8List? file;

  @override
  Future<ParseWebFile> download({ProgressCallback? progressCallback}) async {
    if (url == null) return this;
    try {
      final ParseNetworkResponse response = await WozRest(sendSessionId: false)
          .get(url!,
              byteResponse: true,
              onReceiveProgress: progressCallback ?? _progressCallback,
              cancelToken: _cancelToken);
      file = Uint8List.fromList(response.bytes ?? <int>[]);
    } on Exception {
      file = null;
    }
    return this;
  }

  @override
  Future<ParseResponse> upload({ProgressCallback? progressCallback}) async {
    if (saved) {
      return ParseResponse()
        ..success = true
        ..statusCode = 201
        ..result = <String, String>{'url': url!, 'name': name}
        ..results = <dynamic>[this];
    }
    final Uint8List? bytes = file;
    if (bytes == null) {
      return ParseResponse()
        ..error = ParseError(
            code: ParseError.otherCause, message: 'No bytes to upload');
    }
    try {
      final ParseNetworkResponse response =
          await postFileBytes(bytes, name, progressCallback);
      return finishUpload(response);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.upload, _debug, parseClassName);
    }
  }
}

String _basename(String path) {
  final List<String> parts = path.split(RegExp(r'[\\/]'));
  return parts.isEmpty ? path : parts.last;
}

class ParseUser extends ParseObject implements ParseCloneable {
  ParseUser(String? username, String? password, String? emailAddress,
      {String? sessionToken, bool? debug, dynamic client})
      : super(keyClassUser,
            debug: debug, client: client, autoSendSessionId: true) {
    if (username != null) this.username = username;
    if (emailAddress != null) this.emailAddress = emailAddress;
    if (password != null) this.password = password;
    if (sessionToken != null) this.sessionToken = sessionToken;
    _password = password;
  }

  ParseUser.forQuery() : super(keyClassUser);

  ParseUser.clone(Map<String, dynamic> map)
      : this(map[keyVarUsername] as String?, null,
            map[keyVarEmail] as String?);

  String? _password;

  @override
  dynamic clone(Map<String, dynamic> map) =>
      ParseUser.clone(map)..fromJson(map);

  String? get password => _password;

  set password(String? password) {
    if (password == null) return;
    _password = password;
    set<String?>(keyVarPassword, password);
  }

  static const String keyEmailVerified = 'emailVerified';
  static const String keyUsername = 'username';
  static const String keyEmailAddress = 'email';

  bool? get emailVerified => super.get<bool>(keyEmailVerified);

  set emailVerified(bool? emailVerified) {
    set<bool?>(keyEmailVerified, emailVerified);
  }

  String? get username => super.get<String>(keyVarUsername);

  set username(String? username) => set<String?>(keyVarUsername, username);

  String? get emailAddress => super.get<String>(keyVarEmail);

  set emailAddress(String? emailAddress) =>
      set<String?>(keyVarEmail, emailAddress);

  String? get sessionToken => super.get<String>(keyVarSessionToken);

  set sessionToken(String? sessionToken) =>
      set<String?>(keyVarSessionToken, sessionToken);

  Map<String, dynamic>? get authData =>
      super.get<Map<String, dynamic>>(keyVarAuthData);

  set authData(Map<String, dynamic>? authData) =>
      set<Map<String, dynamic>?>(keyVarAuthData, authData);

  static ParseUser createUser(String? username, String? password,
          String? emailAddress,
          {String? sessionToken}) =>
      ParseCoreData.instance.createParseUser(username, password, emailAddress,
          sessionToken: sessionToken);

  /// Reads the persisted session user; returns the registered UserModel subclass.
  static Future<dynamic> currentUser({ParseCloneable? customUserObject}) async {
    final String? userJson = await ParseCoreData.instance
        .getStore()
        .getString(keyParseStoreUser);
    if (userJson == null) return null;
    final Map<String, dynamic> userMap =
        Map<String, dynamic>.from(jsonDecode(userJson) as Map);
    if (customUserObject != null) return customUserObject.clone(userMap);
    final Object? token = userMap[keyVarSessionToken];
    if (token is String) ParseCoreData.instance.setSessionId(token);
    return parseDecode(userMap);
  }

  static Future<ParseResponse?> getCurrentUserFromServer(String token,
      {bool debug = false}) async {
    final ParseCoreData core = ParseCoreData.instance;
    final String? previous = core.sessionId;
    core.setSessionId(token);
    try {
      final ParseNetworkResponse response = await WozRest().get('/auth/me');
      return handleResponse<ParseUser>(
          core.createParseUser(null, null, null), response, ParseApiRQ.currentUser);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.currentUser, debug, keyClassUser);
    } finally {
      core.setSessionId(previous);
    }
  }

  Future<ParseResponse> getUpdatedUser({String? token}) async {
    final ParseCoreData core = ParseCoreData.instance;
    final String? previous = core.sessionId;
    if (token != null) core.setSessionId(token);
    try {
      final String path =
          objectId == null ? '/auth/me' : '/classes/$keyClassUser/$objectId';
      final ParseNetworkResponse response = await _client.get(path);
      final ParseResponse parsed = handleResponse<ParseUser>(
          this, response, ParseApiRQ.currentUser);
      if (parsed.success) await saveInStorage(keyParseStoreUser);
      return parsed;
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.currentUser, _debug, keyClassUser);
    } finally {
      core.setSessionId(previous);
    }
  }

  Future<ParseResponse> signUp(
      {bool allowWithoutEmail = false,
      bool doNotSendInstallationID = false}) async {
    forgetLocalSession();
    if (username == null || username!.isEmpty) {
      return ParseResponse()
        ..error = ParseError(
            code: ParseError.usernameMissing, message: 'Username is missing.');
    }
    if (password == null || password!.isEmpty) {
      return ParseResponse()
        ..error = ParseError(
            code: ParseError.passwordMissing, message: 'Password is missing.');
    }
    try {
      final ParseNetworkResponse response = await _client.post('/auth/register',
          data: json.encode(toJson(forApiRQ: true)),
          headers: <String, String>{'X-Parse-Revocable-Session': '1'});
      return _applySessionResponse(response, ParseApiRQ.signUp);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.signUp, _debug, keyClassUser);
    }
  }

  Future<ParseResponse> login(
      {bool doNotSendInstallationID = false}) async {
    forgetLocalSession();
    try {
      final ParseNetworkResponse response = await _client.post('/auth/login',
          data: json.encode(<String, dynamic>{
            'username': username,
            'password': password,
          }));
      return _applySessionResponse(response, ParseApiRQ.login);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.login, _debug, keyClassUser);
    }
  }

  static Future<ParseResponse> loginWith(String provider, Object authData,
      {String? username, String? password, String? email,
      bool doNotSendInstallationID = false}) async {
    final Map<String, dynamic> data =
        Map<String, dynamic>.from(authData as Map);
    final Object? rawId = data['id'];
    final Object? token = data['access_token'] ?? data['token'];
    final String? resolvedEmail = email ?? data['email'] as String?;
    final String? resolvedUsername = username ?? data['username'] as String?;
    try {
      final ParseNetworkResponse response =
          await WozRest(sendSessionId: false).post('/auth/social',
              data: json.encode(<String, dynamic>{
                'provider': provider,
                'uid': rawId?.toString() ?? token?.toString(),
                'username': resolvedUsername,
                'email': resolvedEmail,
                'accessToken': token,
              }));
      final ParseUser user = ParseCoreData.instance
          .createParseUser(resolvedUsername, password, resolvedEmail);
      return user._applySessionResponse(response, ParseApiRQ.login);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.login, false, keyClassUser);
    }
  }

  ParseResponse _applySessionResponse(
      ParseNetworkResponse response, ParseApiRQ type) {
    final bool failed =
        response.statusCode != 200 && response.statusCode != 201;
    if (failed) {
      final ParseResponse parsed =
          handleResponse<ParseUser>(this, response, type);
      return parsed;
    }
    final Map<String, dynamic> map =
        Map<String, dynamic>.from(jsonDecode(response.data) as Map);
    final Object? token = map[keyVarSessionToken];
    map.remove(keyVarSessionToken);
    fromJson(map);
    if (token is String) {
      sessionToken = token;
      ParseCoreData.instance.setSessionId(token);
    }
    _password = null;
    clearUnsavedChanges();
    saveInStorage(keyParseStoreUser);
    return ParseResponse()
      ..success = true
      ..statusCode = response.statusCode
      ..result = this
      ..results = <dynamic>[this]
      ..count = 1;
  }

  /// Lists every user; the backend restricts this to admin sessions.
  static Future<ParseResponse> all({bool? debug, dynamic client}) async {
    final QueryBuilder<ParseUser> query =
        QueryBuilder<ParseUser>(ParseUser.forQuery())
          ..orderByDescending(keyVarCreatedAt)
          ..setLimit(100);
    return query.query<ParseUser>();
  }

  Future<ParseResponse> logout({bool deleteLocalUserData = true}) async {
    final ParseCoreData core = ParseCoreData.instance;
    try {
      if (core.sessionId != null) {
        await WozRest().post('/auth/logout', data: json.encode(<String, dynamic>{}));
      }
    } on Exception catch (_) {
      // The local session is dropped regardless; the server token simply expires.
    }
    core.setSessionId(null);
    await core.getStore().remove(keyParseStoreUser);
    if (deleteLocalUserData) await this.deleteLocalUserData();
    return ParseResponse()
      ..success = true
      ..statusCode = 200;
  }

  Future<ParseResponse> requestPasswordReset() async {
    try {
      final ParseNetworkResponse response = await _client.post(
          '/auth/password-reset',
          data: json.encode(<String, dynamic>{'email': emailAddress}));
      return handleResponse<ParseUser>(
          this, response, ParseApiRQ.requestPasswordReset);
    } on Exception catch (e) {
      return handleException(
          e, ParseApiRQ.requestPasswordReset, _debug, keyClassUser);
    }
  }

  Future<ParseResponse> verificationEmailRequest() async {
    return ParseResponse()
      ..success = false
      ..error = ParseError(
          code: ParseError.commandUnavailable,
          message: 'Email verification is not enabled on this backend.');
  }

  void forgetLocalSession() => ParseCoreData.instance.setSessionId(null);

  Future<void> deleteLocalUserData() async {
    await unpin(key: keyParseStoreUser);
    setObjectData(<String, dynamic>{});
  }

  Future<ParseResponse?> destroy() async {
    if (objectId == null) return null;
    final ParseResponse response = await delete<ParseUser>();
    if (response.success) {
      forgetLocalSession();
      await ParseCoreData.instance.getStore().remove(keyParseStoreUser);
    }
    return response;
  }

  @override
  Future<ParseResponse> save({dynamic context}) async {
    if (objectId == null) return signUp();
    final ParseResponse response = await super.save(context: context);
    if (response.success && sessionToken != null) {
      await saveInStorage(keyParseStoreUser);
    }
    return response;
  }

  @override
  Future<ParseResponse> update({dynamic context}) async {
    try {
      final ParseNetworkResponse response = await _client.put(
          '/classes/$keyClassUser/$objectId',
          data: json.encode(toJson(forApiRQ: true)));
      final ParseResponse parsed =
          handleResponse<ParseUser>(this, response, ParseApiRQ.save);
      if (parsed.success) await saveInStorage(keyParseStoreUser);
      return parsed;
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.save, _debug, keyClassUser);
    }
  }
}

class ParseInstallation extends ParseObject {
  ParseInstallation() : super(keyClassInstallation);

  ParseInstallation.forQuery() : super(keyClassInstallation);

  @override
  dynamic clone(Map<String, dynamic> map) =>
      ParseInstallation.forQuery()..fromJson(map);

  static Future<ParseInstallation> currentInstallation() async {
    final CoreStore store = ParseCoreData.instance.getStore();
    final String? json0 = await store.getString(keyParseStoreInstallation);
    final ParseInstallation installation = ParseInstallation.forQuery();
    if (json0 != null) {
      installation.fromJson(Map<String, dynamic>.from(jsonDecode(json0) as Map));
      return installation;
    }
    final String id = uuidV4();
    installation.set('installationId', id);
    ParseCoreData.instance.installationId = id;
    await store.setString(keyParseStoreInstallation,
        json.encode(installation.toJson(full: true)));
    return installation;
  }

  String? get installationId => super.get<String>('installationId');

  set installationId(String? installationId) =>
      set<String?>('installationId', installationId);

  String? get deviceToken => super.get<String>('deviceToken');

  set deviceToken(String? deviceToken) =>
      set<String?>('deviceToken', deviceToken);

  String? get deviceType => super.get<String>('deviceType');

  set deviceType(String? deviceType) => set<String?>('deviceType', deviceType);

  List<String>? get channels => super.get<List<String>>('channels');

  set channels(List<String>? channels) =>
      set<List<String>?>(
          'channels', channels);

  void subscribeToChannel(String channel) {
    final List<String> current =
        List<String>.from(channels ?? <String>[]);
    if (!current.contains(channel)) current.add(channel);
    channels = current;
  }

  void unsubscribeFromChannel(String channel) {
    final List<String> current = List<String>.from(channels ?? <String>[]);
    current.remove(channel);
    channels = current;
  }

  @override
  Future<ParseResponse> save({dynamic context}) async {
    if (installationId == null) {
      installationId = uuidV4();
    }
    ParseCoreData.instance.installationId = installationId;
    await ParseCoreData.instance
        .getStore()
        .setString(keyParseStoreInstallation, json.encode(toJson(full: true)));
    return super.save(context: context);
  }

  static Future<ParseResponse> deleteAll() async {
    return ParseResponse()..success = true;
  }
}

class ParseConfig extends ParseObject {
  ParseConfig({bool? debug, dynamic client, bool? autoSendSessionId})
      : super('config',
            debug: debug, client: client, autoSendSessionId: autoSendSessionId);

  Future<ParseResponse> getConfigs() async {
    try {
      final ParseNetworkResponse response = await _client.get('/config');
      return handleResponse<ParseConfig>(
          this, response, ParseApiRQ.getConfigs, returnAsBaseResult: true);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.getConfigs, _debug, parseClassName);
    }
  }

  Future<ParseResponse> addConfig(String key, dynamic value) async {
    try {
      final ParseNetworkResponse response = await _client.put('/config',
          data: json.encode(<String, dynamic>{
            'params': <String, dynamic>{key: parseEncode(value)}
          }));
      return handleResponse<ParseConfig>(
          this, response, ParseApiRQ.addConfig, returnAsBaseResult: true);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.addConfig, _debug, parseClassName);
    }
  }
}

class ParseCloudFunction extends ParseObject {
  ParseCloudFunction(this.functionName,
      {bool? debug, dynamic client, bool? autoSendSessionId})
      : super(functionName,
            client: client,
            autoSendSessionId: autoSendSessionId,
            debug: debug);

  final String functionName;

  String get _functionPath => '/functions/$functionName';

  Future<ParseResponse> execute(
      {Map<String, dynamic>? parameters,
      Map<String, String>? headers,
      dynamic context}) async {
    try {
      final ParseNetworkResponse response = await _client.post(_functionPath,
          data: json.encode(parameters ?? <String, dynamic>{}),
          headers: headers);
      return handleResponse<ParseCloudFunction>(
          this, response, ParseApiRQ.execute, returnAsBaseResult: true);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.execute, _debug, parseClassName);
    }
  }

  Future<ParseResponse> executeObjectFunction<T extends ParseObject>(
      {Map<String, dynamic>? parameters, Map<String, String>? headers}) async {
    try {
      final ParseNetworkResponse response = await _client.post(_functionPath,
          data: json.encode(parameters ?? <String, dynamic>{}),
          headers: headers);
      return handleResponse<T>(
          ParseCoreData.instance.createObject(functionName),
          response,
          ParseApiRQ.executeObjectFunction);
    } on Exception catch (e) {
      return handleException(
          e, ParseApiRQ.executeObjectFunction, _debug, parseClassName);
    }
  }
}
