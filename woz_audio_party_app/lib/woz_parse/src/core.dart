part of woz_parse;

/// Wire/format constants shared across the facade.
class ParseConstants {
  static const String classNameUser = '_User';
  static const String classNameInstallation = '_Installation';
  static const String classNameSession = '_Session';
  static const String classNameFile = 'ParseFile';

  static const String varObjectId = 'objectId';
  static const String varClassName = 'className';
  static const String varCreatedAt = 'createdAt';
  static const String varUpdatedAt = 'updatedAt';
  static const String varUsername = 'username';
  static const String varEmail = 'email';
  static const String varPassword = 'password';
  static const String varSessionToken = 'sessionToken';
  static const String varAuthData = 'authData';
  static const String varAcl = 'ACL';
  static const String varName = 'name';
  static const String varURL = 'url';
}

const String keyVarObjectId = ParseConstants.varObjectId;
const String keyVarClassName = ParseConstants.varClassName;
const String keyVarCreatedAt = ParseConstants.varCreatedAt;
const String keyVarUpdatedAt = ParseConstants.varUpdatedAt;
const String keyVarUsername = ParseConstants.varUsername;
const String keyVarEmail = ParseConstants.varEmail;
const String keyVarPassword = ParseConstants.varPassword;
const String keyVarSessionToken = ParseConstants.varSessionToken;
const String keyVarAuthData = ParseConstants.varAuthData;
const String keyVarAcl = ParseConstants.varAcl;
const String keyVarName = ParseConstants.varName;
const String keyVarURL = ParseConstants.varURL;
const String keyClassUser = ParseConstants.classNameUser;
const String keyClassInstallation = ParseConstants.classNameInstallation;
const String keyClassSession = ParseConstants.classNameSession;
const String keyFileClassname = ParseConstants.classNameFile;

const String keyParseStoreBase = 'woz_parse_';
const String keyParseStoreUser = '${keyParseStoreBase}user';
const String keyParseStoreInstallation = '${keyParseStoreBase}installation';

/// Parse renders timestamps as `2020-01-02T03:04:05.678Z`.
String formatParseDate(DateTime date) {
  final DateTime utc = date.toUtc();
  String two(int v) => v.toString().padLeft(2, '0');
  String three(int v) => v.toString().padLeft(3, '0');
  return '${utc.year.toString().padLeft(4, '0')}-${two(utc.month)}-${two(utc.day)}'
      'T${two(utc.hour)}:${two(utc.minute)}:${two(utc.second)}'
      '.${three(utc.millisecond)}Z';
}

DateTime? parseParseDate(Object? value) {
  if (value is DateTime) return value;
  if (value is String && value.isNotEmpty) return DateTime.tryParse(value);
  if (value is Map) {
    final Object? iso = value['iso'];
    if (iso is String) return DateTime.tryParse(iso);
  }
  return null;
}

final Random _secureRandom = Random.secure();

String uuidV4() {
  final List<int> bytes = List<int>.generate(16, (_) => _secureRandom.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final String hex = bytes.map((int b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}'
      '-${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// Local error object mirroring the shape the app reads (`code`, `message`).
class ParseError {
  ParseError({this.code = otherCause, this.message = 'OtherCause', this.exception});

  static const int otherCause = -1;
  static const int internalServerError = 1;
  static const int connectionFailed = 100;
  static const int objectNotFound = 101;
  static const int invalidQuery = 102;
  static const int invalidClassName = 103;
  static const int missingObjectId = 104;
  static const int invalidKeyName = 105;
  static const int invalidPointer = 106;
  static const int incorrectType = 111;
  static const int commandUnavailable = 118;
  static const int operationForbidden = 119;
  static const int scriptFailed = 141;
  static const int validationError = 142;
  static const int duplicateValue = 137;
  static const int usernameTaken = 202;
  static const int emailTaken = 203;
  static const int sessionMissing = 206;
  static const int invalidSessionToken = 209;
  static const int usernameMissing = 200;
  static const int passwordMissing = 201;
  static const int aggregateError = 600;
  static const int networkError = 9000;

  final int code;
  final String message;
  final Object? exception;

  String get type => 'ParseError';

  @override
  String toString() => '\n----ParseException (Type: $type) :\nCode: $code'
      '\nMessage: $message\n----';
}

class ParseResponse {
  ParseResponse({this.error});

  bool success = false;
  int statusCode = -1;
  dynamic result;
  List? results;
  int count = 0;
  ParseError? error;
}

enum ParseApiRQ {
  create,
  save,
  fetch,
  delete,
  query,
  getAll,
  batch,
  execute,
  executeObjectFunction,
  getConfigs,
  addConfig,
  login,
  signUp,
  logout,
  currentUser,
  requestPasswordReset,
  verificationEmailRequest,
  healthCheck,
  upload,
  unset,
  increment,
  decrement,
  add,
  addAll,
  addUnique,
  remove,
  removeAll,
  other
}

/// Minimal key/value store used for the session, the current user and the
/// installation id. `SharedPreferences` backs the real app; tests can swap in
/// [CoreStoreMemoryImp].
abstract class CoreStore {
  Future<void> setString(String key, String value);

  Future<String?> getString(String key);

  Future<void> setStringList(String key, List<String> value);

  Future<List<String>?> getStringList(String key);

  Future<bool> remove(String key);

  Future<void> clear();
}

class CoreStoreMemoryImp implements CoreStore {
  final Map<String, String> _strings = <String, String>{};
  final Map<String, List<String>> _lists = <String, List<String>>{};

  @override
  Future<bool> remove(String key) async {
    _strings.remove(key);
    _lists.remove(key);
    return true;
  }

  @override
  Future<void> clear() async {
    _strings.clear();
    _lists.clear();
  }

  @override
  Future<String?> getString(String key) async => _strings[key];

  @override
  Future<void> setString(String key, String value) async {
    _strings[key] = value;
  }

  @override
  Future<List<String>?> getStringList(String key) async => _lists[key];

  @override
  Future<void> setStringList(String key, List<String> value) async {
    _lists[key] = value;
  }
}

class CoreStoreSharedPreferencesImp implements CoreStore {
  CoreStoreSharedPreferencesImp(this._prefs);

  static Future<CoreStoreSharedPreferencesImp> getInstance(
      {String? fileName}) async {
    return CoreStoreSharedPreferencesImp(await SharedPreferences.getInstance());
  }

  final SharedPreferences _prefs;

  @override
  Future<String?> getString(String key) async => _prefs.getString(key);

  @override
  Future<void> setString(String key, String value) =>
      _prefs.setString(key, value);

  @override
  Future<List<String>?> getStringList(String key) async =>
      _prefs.getStringList(key);

  @override
  Future<void> setStringList(String key, List<String> value) =>
      _prefs.setStringList(key, value);

  @override
  Future<bool> remove(String key) => _prefs.remove(key);

  @override
  Future<void> clear() => _prefs.clear();
}

/// Server location, session and class registry.
class ParseCoreData {
  ParseCoreData._();

  static final ParseCoreData _instance = ParseCoreData._();

  static ParseCoreData get instance => _instance;

  String applicationId = '';
  String serverUrl = '';
  String? liveQueryURL;
  String? clientKey;
  String? masterKey;
  String? sessionId;
  bool autoSendSessionId = true;
  bool debug = false;
  String? appName;
  String? appVersion;
  String? appPackageName;
  String? locale;
  String? installationId;

  CoreStore store = CoreStoreMemoryImp();
  Map<String, ParseObjectConstructor> subClassMap =
      <String, ParseObjectConstructor>{};
  ParseUserConstructor? userConstructor;
  ParseFileConstructor? fileConstructor;

  static void init(
    String appId,
    String url, {
    bool debug = false,
    String? appName,
    String? appVersion,
    String? appPackageName,
    String? locale,
    String? liveQueryUrl,
    String? clientKey,
    String? masterKey,
    String? sessionId,
    bool autoSendSessionId = true,
    CoreStore? store,
    Map<String, ParseObjectConstructor>? registeredSubClassMap,
    ParseUserConstructor? parseUserConstructor,
    ParseFileConstructor? parseFileConstructor,
  }) {
    _instance
      ..applicationId = appId
      ..serverUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url
      ..debug = debug
      ..appName = appName
      ..appVersion = appVersion
      ..appPackageName = appPackageName
      ..locale = locale
      ..clientKey = clientKey
      ..masterKey = masterKey
      ..autoSendSessionId = autoSendSessionId
      ..liveQueryURL = liveQueryUrl == null
          ? null
          : (liveQueryUrl.startsWith('http')
              ? liveQueryUrl
                  .replaceFirst('https', 'wss')
                  .replaceFirst('http', 'ws')
              : liveQueryUrl);
    if (sessionId != null) _instance.sessionId = sessionId;
    if (store != null) _instance.store = store;
    if (registeredSubClassMap != null) {
      _instance.subClassMap =
          Map<String, ParseObjectConstructor>.fromEntries(registeredSubClassMap
              .entries
              .where((MapEntry<String, ParseObjectConstructor> entry) =>
                  entry.key != keyClassUser &&
                  entry.key != keyClassInstallation &&
                  entry.key != keyClassSession));
    }
    _instance.userConstructor = parseUserConstructor;
    _instance.fileConstructor = parseFileConstructor;
  }

  void setSessionId(String? sessionId) {
    this.sessionId = sessionId;
  }

  ParseObject createObject(String className) {
    if (className == keyClassUser) {
      return createParseUser(null, null, null);
    }
    if (className == keyClassInstallation) {
      return ParseInstallation.forQuery();
    }
    return subClassMap.containsKey(className)
        ? subClassMap[className]!()
        : ParseObject(className);
  }

  ParseUser createParseUser(String? username, String? password, String? emailAddress,
      {String? sessionToken}) {
    if (userConstructor != null) {
      return userConstructor!(username, password, emailAddress,
          sessionToken: sessionToken);
    }
    return ParseUser(username, password, emailAddress,
        sessionToken: sessionToken);
  }

  ParseFileBase createFile({String? name, String? url}) {
    if (fileConstructor != null) {
      return fileConstructor!(name: name, url: url);
    }
    if (parseIsWeb) {
      return ParseWebFile(null, name: name ?? '', url: url);
    }
    return ParseFile(null, name: name, url: url);
  }

  CoreStore getStore() => store;
}

/// Raw HTTP result from [WozRest].
class ParseNetworkResponse {
  ParseNetworkResponse({required this.statusCode, required this.data, this.bytes});

  final int statusCode;
  final String data;
  final List<int>? bytes;
}

typedef ProgressCallback = void Function(int count, int total);

/// Thin REST layer over the woz-backend API. All Parse-style paths handed to
/// this client are relative to [ParseCoreData.serverUrl], which already points
/// at `/api`.
class WozRest {
  WozRest({bool sendSessionId = true}) : _sendSessionId = sendSessionId;

  final bool _sendSessionId;
  final Dio _dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 60),
      listFormat: ListFormat.multiCompatible,
      responseType: ResponseType.plain));

  Map<String, String> _headers(Map<String, String>? extra) {
    final ParseCoreData core = ParseCoreData.instance;
    final Map<String, String> headers = <String, String>{
      'X-Parse-Application-Id': core.applicationId,
      'Accept': 'application/json',
    };
    if (core.clientKey != null && core.clientKey!.isNotEmpty) {
      headers['X-Parse-Client-Key'] = core.clientKey!;
    }
    if (_sendSessionId && core.sessionId != null) {
      headers['Authorization'] = 'Bearer ${core.sessionId}';
      headers['X-Parse-Session-Token'] = core.sessionId!;
    }
    if (extra != null) headers.addAll(extra);
    return headers;
  }

  Future<ParseNetworkResponse> send(
    String method,
    String path, {
    Map<String, dynamic>? query,
    Object? data,
    Map<String, String>? headers,
    ProgressCallback? onSendProgress,
    ProgressCallback? onReceiveProgress,
    CancelToken? cancelToken,
    bool rawBody = false,
    bool byteResponse = false,
  }) async {
    final String url = path.startsWith('http') ? path : '${ParseCoreData.instance.serverUrl}$path';
    try {
      final Response<dynamic> response = await _dio.request<dynamic>(
        url,
        queryParameters: query,
        data: data,
        options: Options(
          method: method,
          headers: _headers(headers),
          contentType: rawBody
              ? (headers?['content-type'] ?? headers?['Content-Type'] ??
                  'application/octet-stream')
              : 'application/json',
          responseType: byteResponse ? ResponseType.bytes : ResponseType.plain,
          sendTimeout: const Duration(minutes: 5),
          validateStatus: (_) => true,
        ),
        onSendProgress: onSendProgress,
        onReceiveProgress: onReceiveProgress,
        cancelToken: cancelToken,
      );
      if (byteResponse) {
        final List<int> bytes = (response.data == null)
            ? <int>[]
            : (response.data as dynamic) as List<int>;
        return ParseNetworkResponse(
            statusCode: response.statusCode ?? 500,
            data: '',
            bytes: bytes);
      }
      return ParseNetworkResponse(
        statusCode: response.statusCode ?? 500,
        data: response.data ?? '',
      );
    } on DioException catch (e) {
      if (e.type == DioExceptionType.cancel) {
        throw ParseExceptionRequestCancelled(e.message ?? 'cancelled');
      }
      throw ParseFailure(
          ParseError(
              code: ParseError.connectionFailed,
              message: '${e.message ?? 'NetworkError'} (${e.type.name})',
              exception: e),
          null);
    }
  }

  Future<ParseNetworkResponse> get(String path,
          {Map<String, dynamic>? query,
          ProgressCallback? onReceiveProgress,
          CancelToken? cancelToken,
          Map<String, String>? headers,
          bool byteResponse = false}) =>
      send('GET', path,
          query: query,
          headers: headers,
          onReceiveProgress: onReceiveProgress,
          cancelToken: cancelToken,
          byteResponse: byteResponse);

  Future<ParseNetworkResponse> post(String path,
          {Object? data, Map<String, String>? headers, CancelToken? cancelToken}) =>
      send('POST', path, data: data, headers: headers, cancelToken: cancelToken);

  Future<ParseNetworkResponse> put(String path,
          {Object? data, Map<String, String>? headers}) =>
      send('PUT', path, data: data, headers: headers);

  Future<ParseNetworkResponse> delete(String path,
          {Map<String, dynamic>? query, Map<String, String>? headers}) =>
      send('DELETE', path, query: query, headers: headers);
}

class ParseExceptionRequestCancelled implements Exception {
  ParseExceptionRequestCancelled(this.message);

  final String message;
}

class ParseFailure implements Exception {
  ParseFailure(this.error, this.response);

  final ParseError error;
  final ParseNetworkResponse? response;
}

/// Converts a transport response into the [ParseResponse] shape the app expects.
ParseResponse handleResponse<T>(
    dynamic object, ParseNetworkResponse apiResponse, ParseApiRQ type,
    {bool returnAsBaseResult = false}) {
  final ParseResponse response = ParseResponse()
    ..statusCode = apiResponse.statusCode;

  final bool failed =
      apiResponse.statusCode != 200 && apiResponse.statusCode != 201;
  if (failed || type == ParseApiRQ.delete && apiResponse.statusCode == 204) {
    if (apiResponse.statusCode == 204) {
      return response
        ..success = true
        ..statusCode = 200;
    }
    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final dynamic decoded = apiResponse.data.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(apiResponse.data);
      if (decoded is Map<String, dynamic>) body = decoded;
    } on FormatException {
      body = <String, dynamic>{'error': apiResponse.data};
    }
    response.statusCode = apiResponse.statusCode;
    response.error = ParseError(
        code: (body['code'] as num?)?.toInt() ?? ParseError.otherCause,
        message: (body['error'] ?? body['message'] ?? 'Request failed').toString());
    return response;
  }

  response.success = true;

  if (apiResponse.data.isEmpty) return response;

  dynamic decoded;
  try {
    decoded = jsonDecode(apiResponse.data);
  } on FormatException {
    response.result = apiResponse.data;
    return response;
  }

  if (returnAsBaseResult || type == ParseApiRQ.execute ||
      type == ParseApiRQ.getConfigs || type == ParseApiRQ.addConfig ||
      type == ParseApiRQ.healthCheck ||
      type == ParseApiRQ.increment || type == ParseApiRQ.decrement ||
      type == ParseApiRQ.add || type == ParseApiRQ.addAll ||
      type == ParseApiRQ.addUnique || type == ParseApiRQ.remove ||
      type == ParseApiRQ.removeAll || type == ParseApiRQ.unset) {
    if (decoded is Map && decoded.containsKey('params')) {
      response.result = parseDecode(decoded['params']);
    } else if (decoded is Map && decoded.containsKey('result')) {
      response.result = parseDecode(decoded['result']);
    } else {
      response.result = parseDecode(decoded);
    }
    return response;
  }

  if (decoded is Map && decoded.containsKey('results')) {
    final List<dynamic> raw = (decoded['results'] as List).cast<dynamic>();
    final List<dynamic> items = <dynamic>[];
    for (final dynamic value in raw) {
      items.add(_materialise(object, value));
    }
    response.results = items;
    response.result = items;
    response.count = (decoded['count'] as num?)?.toInt() ?? items.length;
    return response;
  }

  if (decoded is Map && decoded.containsKey('count')) {
    final int count = (decoded['count'] as num).toInt();
    response.count = count;
    response.results = <int>[count];
    response.result = <int>[count];
    return response;
  }

  if (decoded is Map &&
      decoded.containsKey(keyVarObjectId) &&
      !decoded.containsKey('results')) {
    // A create/update acknowledgement: merge the server timestamp back into the
    // originating object.
    if (object is ParseObject) {
      object.fromJson(_withCreatedAt(decoded, object));
      object.clearUnsavedChanges();
    }
    response.count = 1;
    response.result = object;
    response.results = <dynamic>[object];
    return response;
  }

  final dynamic materialised = _materialise(object, decoded);
  response.count = 1;
  response.result = materialised;
  response.results = <dynamic>[materialised];
  return response;
}

Map<String, dynamic> _withCreatedAt(Map<dynamic, dynamic> body, ParseObject object) {
  final Map<String, dynamic> map = Map<String, dynamic>.from(body);
  if (!map.containsKey(keyVarObjectId) && object.objectId != null) {
    map[keyVarObjectId] = object.objectId;
  }
  return map;
}

dynamic _materialise(dynamic template, dynamic raw) {
  if (raw is! Map) return raw;
  final Map<String, dynamic> map = Map<String, dynamic>.from(raw);
  if (map.containsKey('__type')) {
    final String? className = map['className'];
    if (className != null && template is ParseObject) {
      final ParseObject clone = ParseCoreData.instance
          .createObject(template.parseClassName);
      return clone.fromJson(map);
    }
    if (className != null) {
      return ParseCoreData.instance.createObject(className).fromJson(map);
    }
    return parseDecode(map);
  }
  if (map.containsKey(keyVarClassName)) {
    return ParseCoreData.instance
        .createObject(map[keyVarClassName] as String)
        .fromJson(map);
  }
  if (template is ParseCloneable) {
    return template.clone(map);
  }
  if (template is ParseObject) {
    return ParseCoreData.instance
        .createObject(template.parseClassName)
        .fromJson(map);
  }
  return map;
}

ParseResponse handleException(
    Object exception, ParseApiRQ type, bool debug, String className) {
  final ParseResponse response = ParseResponse()..success = false;
  if (exception is ParseFailure) {
    response.error = exception.error;
    response.statusCode = exception.error.code;
  } else if (exception is ParseExceptionRequestCancelled) {
    response.error = ParseError(
        code: ParseError.otherCause, message: exception.message);
  } else {
    response.error = ParseError(
        code: ParseError.otherCause, message: exception.toString());
  }
  if (debug) {
    print('woz_parse $className ${type.name} failed: ${response.error}');
  }
  return response;
}

/// authData payloads for `ParseUser.loginWith`, matching the old SDK helpers.
Map<String, dynamic> facebook(String token, String id, DateTime expires) =>
    <String, dynamic>{
      'access_token': token,
      'id': id,
      'expiration_date': expires.toString()
    };

Map<String, dynamic> google(String token, String id, String idToken,
        {String? email, String? username}) =>
    <String, dynamic>{
      'access_token': token,
      'id': id,
      'id_token': idToken,
      if (email != null) 'email': email,
      if (username != null) 'username': username,
    };

Map<String, dynamic> apple(String token, String id) =>
    <String, dynamic>{'token': token, 'id': id};
