part of woz_parse;

/// Creates a subclass instance from a server payload.
abstract class ParseCloneable {
  dynamic clone(Map<String, dynamic> map);
}

typedef ParseObjectConstructor = ParseObject Function();

typedef ParseUserConstructor = ParseUser Function(
    String? username, String? password, String? emailAddress,
    {String? sessionToken, bool? debug, dynamic client});

typedef ParseFileConstructor = ParseFileBase Function({String? name, String? url});

abstract class ParseBase {
  ParseBase();

  final Map<String, dynamic> _objectData = <String, dynamic>{};
  final Map<String, dynamic> _unsavedChanges = <String, dynamic>{};

  late String parseClassName;

  String? get objectId => get<String>(keyVarObjectId);

  set objectId(String? objectId) => set<String?>(keyVarObjectId, objectId);

  void setObjectIdUnsafe(String? objectId) {
    if (objectId == null) return;
    _objectData[keyVarObjectId] = objectId;
  }

  DateTime? get createdAt {
    final dynamic value = get<dynamic>(keyVarCreatedAt);
    if (value is DateTime) return value;
    return parseParseDate(value);
  }

  set createdAt(DateTime? createdAt) {
    if (createdAt == null) {
      _objectData.remove(keyVarCreatedAt);
    } else {
      _objectData[keyVarCreatedAt] = createdAt;
    }
  }

  DateTime? get updatedAt {
    final dynamic value = get<dynamic>(keyVarUpdatedAt);
    if (value is DateTime) return value;
    return parseParseDate(value);
  }

  set updatedAt(DateTime? updatedAt) {
    if (updatedAt == null) {
      _objectData.remove(keyVarUpdatedAt);
    } else {
      _objectData[keyVarUpdatedAt] = updatedAt;
    }
  }

  bool isDirty({String? key}) {
    if (key != null) return _unsavedChanges.containsKey(key);
    return _unsavedChanges.isNotEmpty;
  }

  Map<String, dynamic> get unsavedChanges => _unsavedChanges;

  void clearUnsavedChanges() => _unsavedChanges.clear();

  Map<String, dynamic> toJson({
    bool full = false,
    bool forApiRQ = false,
    bool allowCustomObjectId = false,
  }) {
    final Map<String, dynamic> map = <String, dynamic>{
      keyVarClassName: parseClassName,
    };
    if (objectId != null) map[keyVarObjectId] = objectId;
    if (createdAt != null) map[keyVarCreatedAt] = formatParseDate(createdAt!);
    if (updatedAt != null) map[keyVarUpdatedAt] = formatParseDate(updatedAt!);

    final Map<String, dynamic> target =
        forApiRQ ? _unsavedChanges : _objectData;
    target.forEach((String key, dynamic value) {
      map[key] = parseEncode(value, full: full);
    });

    if (forApiRQ) {
      map.remove(keyVarCreatedAt);
      map.remove(keyVarUpdatedAt);
      map.remove(keyVarClassName);
      if (!allowCustomObjectId) map.remove(keyVarObjectId);
      map.remove('sessionToken');
    }
    return map;
  }

  @override
  String toString() => json.encode(toJson(full: true));

  dynamic fromJsonForManualObject(Map<String, dynamic> objectData) =>
      _fromJson(objectData, true);

  dynamic fromJson(Map<String, dynamic> objectData) =>
      _fromJson(objectData, false);

  dynamic _fromJson(Map<String, dynamic> objectData, bool addInUnSave) {
    objectData.forEach((String key, dynamic value) {
      if (key == '__type' || key == parseClassName) {
        // no op
      } else if (key == keyVarObjectId) {
        _objectData[keyVarObjectId] = value;
      } else if (key == keyVarCreatedAt || key == keyVarUpdatedAt) {
        _objectData[key] = value is String ? parseParseDate(value) ?? value : value;
      } else if (key == keyVarAcl) {
        _objectData[keyVarAcl] = ParseACL().fromJson(value);
      } else if (key == keyVarClassName) {
        // no op
      } else {
        final dynamic decoded = parseDecode(value);
        _objectData[key] = decoded;
        if (addInUnSave) _unsavedChanges[key] = decoded;
      }
    });
    return this;
  }

  dynamic copy() => fromJson(toJson());

  void setObjectData(Map<String, dynamic> objectData) {
    _objectData
      ..clear()
      ..addAll(objectData);
  }

  Map<String, dynamic> getObjectData() => _objectData;

  bool containsValue(Object value) {
    for (final dynamic val in _objectData.values) {
      if (val is ParseOperation) {
        if (val.previewValue(null) == value) return true;
      } else if (val == value) {
        return true;
      }
    }
    return false;
  }

  bool containsKey(String key) => _objectData.containsKey(key);

  dynamic operator [](String key) => get<dynamic>(key);

  void operator []=(String key, dynamic value) => set<dynamic>(key, value);

  void set<T>(String key, T value, {bool forceUpdate = true}) {
    if (!forceUpdate && _objectData[key] == value) return;
    _objectData[key] = value;
    _unsavedChanges[key] = value;
  }

  /// Merges a server `__op` payload with whatever the field holds locally.
  void setOperation(String key, ParseOperation operation) {
    _objectData[key] = operation;
    _unsavedChanges[key] = operation;
  }

  T? get<T>(String key, {T? defaultValue}) {
    if (!_objectData.containsKey(key)) return defaultValue;
    dynamic result = _objectData[key];
    if (result is ParseOperation) result = result.previewValue(null);
    if (result is T) return result;
    if (result == null) return null;
    if (T == dynamic) return result as T;
    // Numeric widening/soft casts keep model getters tolerant of JSON types.
    if (result is num) {
      if (T == int) return result.toInt() as T;
      if (T == double) return result.toDouble() as T;
      if (T == String) return result.toString() as T;
    }
    if (T == String && result is DateTime) return formatParseDate(result) as T;
    if (T == bool && result is String) return (result == 'true') as T;
    if (T == String && result is List) {
      final List<dynamic> list = result;
      if (list.isNotEmpty && list.first is String) return list.first as T;
    }
    // JSON decodes every array as List<dynamic>; rebuild it for typed readers.
    if (result is List) {
      final List<dynamic> list = result;
      final List<List<dynamic>> candidates = <List<dynamic>>[
        list.whereType<String>().toList(),
        list.whereType<int>().toList(),
        list.whereType<double>().toList(),
        list.whereType<bool>().toList(),
        list.map((dynamic e) => e is Map ? Map<String, dynamic>.from(e) : e).toList(),
      ];
      for (final List<dynamic> built in candidates) {
        final dynamic candidate = built;
        if (built.length == list.length && candidate is T) {
          return candidate;
        }
      }
    }
    if (result is Map && T != dynamic) {
      final dynamic cast = Map<String, dynamic>.from(result);
      if (cast is T) return cast;
    }
    return result as T?;
  }

  Future<void> saveInStorage(String key) async {
    final String objectJson = json.encode(toJson(full: true));
    await ParseCoreData.instance.getStore().setString(key, objectJson);
  }

  Future<bool> pin() async {
    if (objectId == null) return false;
    await unpin();
    await saveInStorage(objectId!);
    return true;
  }

  Future<bool> unpin({String? key}) async {
    if (objectId == null && key == null) return false;
    await ParseCoreData.instance.getStore().remove(key ?? objectId!);
    return true;
  }

  Future<dynamic> fromPin(String objectId) async {
    final String? item = await ParseCoreData.instance.getStore().getString(objectId);
    if (item == null) return null;
    return fromJson(Map<String, dynamic>.from(jsonDecode(item) as Map));
  }

  Map<String, dynamic> toPointer() =>
      encodeObject(parseClassName, objectId ?? '');

  void setACL(ParseACL acl) => set(keyVarAcl, acl);

  ParseACL getACL() {
    final dynamic acl = _objectData[keyVarAcl];
    return acl is ParseACL ? acl : ParseACL();
  }
}

class ParseObject extends ParseBase implements ParseCloneable {
  ParseObject(String className, {bool? debug, dynamic client, bool? autoSendSessionId})
      : super() {
    parseClassName = className;
    _sendSessionId = autoSendSessionId ?? ParseCoreData.instance.autoSendSessionId;
  }

  ParseObject.clone(String className) : this(className);

  bool _sendSessionId = true;

  String get _path => '/classes/$parseClassName';

  WozRest get _client => WozRest(sendSessionId: _sendSessionId);

  bool get _debug => ParseCoreData.instance.debug;

  @override
  dynamic clone(Map<String, dynamic> map) =>
      ParseObject.clone(parseClassName)..fromJson(map);

  /// Creates a bare object for a class without touching the network.
  static ParseObject forClassName(String className) =>
      ParseCoreData.instance.createObject(className);

  Future<ParseResponse> getObject(String objectId,
      {List<String>? include}) async {
    try {
      final Map<String, dynamic> query = <String, dynamic>{};
      if (include != null && include.isNotEmpty) {
        query['include'] = include.join(',');
      }
      final ParseNetworkResponse result =
          await _client.get('$_path/$objectId', query: query.isEmpty ? null : query);
      return handleResponse<ParseObject>(this, result, ParseApiRQ.fetch);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.fetch, _debug, parseClassName);
    }
  }

  Future<ParseResponse> getAll() async {
    try {
      final ParseNetworkResponse result = await _client.get(_path);
      return handleResponse<ParseObject>(this, result, ParseApiRQ.getAll);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.getAll, _debug, parseClassName);
    }
  }

  Future<ParseResponse> create(
      {bool useMasterKey = false, dynamic context}) async {
    try {
      final ParseNetworkResponse result = await _client
          .post(_path, data: json.encode(toJson(forApiRQ: true)));
      return handleResponse<ParseObject>(this, result, ParseApiRQ.create);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.create, _debug, parseClassName);
    }
  }

  Future<ParseResponse> update({dynamic context}) async {
    if (objectId == null) {
      return ParseResponse()
        ..error = ParseError(
            code: ParseError.missingObjectId, message: 'Missing object id');
    }
    try {
      final ParseNetworkResponse result = await _client.put(
          '$_path/$objectId', data: json.encode(toJson(forApiRQ: true)));
      return handleResponse<ParseObject>(this, result, ParseApiRQ.save);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.save, _debug, parseClassName);
    }
  }

  /// Saves child pointers/files first, then create-or-update this object.
  Future<ParseResponse> save({dynamic context}) =>
      _saveWithContext(context, <ParseObject>{});

  Future<ParseResponse> _saveWithContext(
      dynamic context, Set<ParseObject> inProgress) async {
    inProgress.add(this);
    final ParseResponse children = await _saveChildren(this, inProgress);
    if (!children.success) return children;

    if (objectId == null) return create(context: context);
    if (!isDirty()) {
      return ParseResponse()
        ..success = true
        ..statusCode = 200
        ..result = this
        ..results = <dynamic>[this]
        ..count = 1;
    }
    return update(context: context);
  }

  static Future<ParseResponse> _saveChildren(
      dynamic object, Set<ParseObject> inProgress) async {
    final Set<ParseObject> objects = <ParseObject>{};
    final Set<ParseFileBase> files = <ParseFileBase>{};
    _collectDirtyChildren(object, objects, files, <dynamic>{});
    objects.removeWhere((ParseObject child) => inProgress.contains(child));

    for (final ParseFileBase file in files) {
      if (!file.saved) {
        final ParseResponse response = await file.upload();
        if (!response.success) return response;
      }
    }
    for (final ParseObject child in objects) {
      if (child.objectId == null || child.isDirty()) {
        final ParseResponse response =
            await child._saveWithContext(null, inProgress);
        if (!response.success) return response;
      }
    }
    return ParseResponse()..success = true;
  }

  static void _collectDirtyChildren(dynamic value, Set<ParseObject> objects,
      Set<ParseFileBase> files, Set<dynamic> seen) {
    if (value == null || seen.contains(value)) return;
    seen.add(value);
    if (value is ParseFileBase) {
      files.add(value);
      return;
    }
    if (value is ParseObject) {
      objects.add(value);
      for (final dynamic child in value.getObjectData().values) {
        _collectDirtyChildren(
            child is ParseOperation ? child.value : child, objects, files, seen);
      }
      return;
    }
    if (value is Map) {
      for (final dynamic child in value.values) {
        _collectDirtyChildren(child, objects, files, seen);
      }
      return;
    }
    if (value is Iterable) {
      for (final dynamic child in value) {
        _collectDirtyChildren(child, objects, files, seen);
      }
    }
  }

  Future<ParseResponse> saveEventually() => save();

  ParseRelation<T> getRelation<T extends ParseObject>(String key) {
    final dynamic value = getObjectData()[key];
    if (value is ParseRelation<T>) return value..attach(this, key);
    final ParseRelation<T> relation = ParseRelation<T>(this, key);
    set(key, relation);
    return relation;
  }

  void setAdd<T>(String key, T element) =>
      setOperation(key, _AddOperation(key, <dynamic>[element]));

  void setAddAll(String key, List<dynamic> elements) =>
      setOperation(key, _AddOperation(key, elements));

  void setAddUnique(String key, dynamic element) =>
      setOperation(key, _AddUniqueOperation(key, <dynamic>[element]));

  void setAddAllUnique(String key, List<dynamic> elements) =>
      setOperation(key, _AddUniqueOperation(key, elements));

  void setRemove(String key, dynamic element) =>
      setOperation(key, _RemoveOperation(key, <dynamic>[element]));

  void setRemoveAll(String key, List<dynamic> elements) =>
      setOperation(key, _RemoveOperation(key, elements));

  void addRelation(String key, List<ParseObject> objects) =>
      setOperation(key, _AddOperation(key, objects));

  void removeRelation(String key, List<ParseObject> objects) =>
      setOperation(key, _RemoveOperation(key, objects));

  void setIncrement(String key, num amount) =>
      setOperation(key, _IncrementOperation(key, amount));

  void setDecrement(String key, num amount) =>
      setOperation(key, _IncrementOperation(key, -amount));

  Future<ParseResponse> unset(String key, {bool offlineOnly = false}) async {
    setOperation(key, _DeleteOperation(key));
    if (objectId == null) return ParseResponse()..success = true;
    return save();
  }

  Future<ParseResponse> query<T extends ParseObject>(String queryString,
      {ProgressCallback? progressCallback}) async {
    try {
      final Map<String, dynamic> params = parseQueryString(queryString);
      final ParseNetworkResponse result = await _client.get(_path, query: params);
      return handleResponse<T>(this, result, ParseApiRQ.query);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.query, _debug, parseClassName);
    }
  }

  Future<ParseResponse> distinct<T extends ParseObject>(String queryString) =>
      query<T>(queryString);

  Future<ParseResponse> deleteEventually() => delete();

  Future<ParseResponse> delete<T extends ParseObject>(
      {String? id, String? path}) async {
    final String? target = id ?? objectId;
    if (target == null || target.isEmpty) {
      return ParseResponse()
        ..error = ParseError(
            code: ParseError.missingObjectId,
            message: "Can't delete an object without a objectId");
    }
    try {
      final ParseNetworkResponse result =
          await _client.delete('${path ?? _path}/$target');
      return handleResponse<T>(this, result, ParseApiRQ.delete);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.delete, _debug, parseClassName);
    }
  }

  /// Re-reads this object from the server, like Parse's `fetch`.
  Future<ParseObject> fetch({List<String>? include}) async {
    if (objectId == null || objectId!.isEmpty) {
      throw 'can not fetch without a objectId';
    }
    final ParseResponse response = await getObject(objectId!, include: include);
    if (response.success && response.results != null && response.results!.isNotEmpty) {
      return response.results!.first as ParseObject;
    }
    return this;
  }

  static Future<void> submitEventually({bool includeUsers = true}) async {}
}

/// Accepts the query string style the app inherited from Parse
/// (`where={...}&limit=10&order=-createdAt`) and returns Dio query parameters.
Map<String, dynamic> parseQueryString(String queryString) {
  final Map<String, dynamic> out = <String, dynamic>{};
  if (queryString.isEmpty) return out;
  final String trimmed =
      queryString.startsWith('?') ? queryString.substring(1) : queryString;
  for (final String pair in trimmed.split('&')) {
    if (pair.isEmpty) continue;
    final int eq = pair.indexOf('=');
    if (eq == -1) {
      out[pair] = '';
      continue;
    }
    final String key = pair.substring(0, eq);
    String value = pair.substring(eq + 1);
    if (key == 'where') {
      try {
        value = jsonDecode(value) is String
            ? jsonDecode(value) as String
            : jsonEncode(jsonDecode(value));
      } on FormatException {
        // keep as-is
      }
    }
    out[key] = value;
  }
  return out;
}
