part of woz_parse;

/// A pending dirty operation on a key, serialised as a Parse `__op` payload.
abstract class ParseOperation {
  const ParseOperation(this.key, this.value);

  final String key;
  final dynamic value;

  /// Best guess of the value the field will hold once saved.
  dynamic previewValue(dynamic current);

  Map<String, dynamic> toOperation();

  Map<String, dynamic> toJson() => toOperation();
}

class _IncrementOperation extends ParseOperation {
  const _IncrementOperation(String key, num amount) : super(key, amount);

  num get amount => value as num;

  @override
  dynamic previewValue(dynamic current) =>
      (current is num ? current : 0) + amount;

  @override
  Map<String, dynamic> toOperation() => <String, dynamic>{
        '__op': amount >= 0 ? 'Increment' : 'Decrement',
        'amount': amount.abs()
      };
}

class _AddOperation extends ParseOperation {
  const _AddOperation(String key, List<dynamic> elements) : super(key, elements);

  List<dynamic> get elements => value as List<dynamic>;

  @override
  dynamic previewValue(dynamic current) =>
      <dynamic>[...(current is List ? current : <dynamic>[]), ...elements];

  @override
  Map<String, dynamic> toOperation() => <String, dynamic>{
        '__op': 'Add',
        'objects': elements.map(parseEncode).toList()
      };
}

class _AddUniqueOperation extends ParseOperation {
  const _AddUniqueOperation(String key, List<dynamic> elements) : super(key, elements);

  List<dynamic> get elements => value as List<dynamic>;

  @override
  dynamic previewValue(dynamic current) {
    final List<dynamic> merged =
        <dynamic>[...(current is List ? current : <dynamic>[])];
    for (final dynamic element in elements) {
      if (!merged.any((dynamic e) => _sameValue(e, element))) merged.add(element);
    }
    return merged;
  }

  @override
  Map<String, dynamic> toOperation() => <String, dynamic>{
        '__op': 'AddUnique',
        'objects': elements.map(parseEncode).toList()
      };
}

class _RemoveOperation extends ParseOperation {
  const _RemoveOperation(String key, List<dynamic> elements) : super(key, elements);

  List<dynamic> get elements => value as List<dynamic>;

  @override
  dynamic previewValue(dynamic current) {
    final List<dynamic> merged =
        <dynamic>[...(current is List ? current : <dynamic>[])];
    merged.removeWhere((dynamic e) => elements.any((dynamic x) => _sameValue(e, x)));
    return merged;
  }

  @override
  Map<String, dynamic> toOperation() => <String, dynamic>{
        '__op': 'Remove',
        'objects': elements.map(parseEncode).toList()
      };
}

class _DeleteOperation extends ParseOperation {
  const _DeleteOperation(String key) : super(key, null);

  @override
  dynamic previewValue(dynamic current) => null;

  @override
  Map<String, dynamic> toOperation() => <String, dynamic>{'__op': 'Delete'};
}

bool _sameValue(dynamic a, dynamic b) {
  if (a is ParseObject && b is ParseObject) return a.objectId == b.objectId;
  return deepEqual(a, b);
}

bool deepEqual(dynamic a, dynamic b) {
  if (identical(a, b)) return true;
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (int i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final dynamic key in a.keys) {
      if (!b.containsKey(key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return a == b;
}

/// Turns Dart values into the JSON the backend understands.
dynamic parseEncode(dynamic value, {bool full = false}) {
  if (value is Uint8List) {
    return <String, dynamic>{'__type': 'Bytes', 'base64': base64Encode(value)};
  }
  if (value is DateTime) return _encodeDate(value);
  if (value is Iterable) {
    return value.map<dynamic>((dynamic v) => parseEncode(v, full: full)).toList();
  }
  if (value is ParseOperation) return value.toJson();
  if (value is Map) {
    final Map<String, dynamic> out = <String, dynamic>{};
    value.forEach((dynamic k, dynamic v) => out['$k'] = parseEncode(v, full: full));
    return out;
  }
  if (value is ParseGeoPoint) return value.toJson();
  if (value is ParseFileBase) return value.toJson();
  if (value is ParseRelation) return value.toJson();
  if (value is ParseACL) return value.toJson();
  if (value is ParseObject) {
    if (full) return value.toJson(full: true);
    if (value.objectId == null) return null;
    return <String, String>{
      '__type': 'Pointer',
      keyVarClassName: value.parseClassName,
      keyVarObjectId: value.objectId!
    };
  }
  return value;
}

Map<String, dynamic> _encodeDate(DateTime date) => <String, dynamic>{
      '__type': 'Date',
      'iso': formatParseDate(date)
    };

Map<String, String> encodeObject(String className, String objectId) =>
    <String, String>{
      '__type': 'Pointer',
      keyVarClassName: className,
      keyVarObjectId: objectId
    };

/// Turns backend JSON back into Dart/Parse values.
dynamic parseDecode(dynamic value) {
  if (value is List) {
    return value.map<dynamic>(parseDecode).toList();
  }
  if (value is! Map) return value;

  final Map<String, dynamic> map = Map<String, dynamic>.from(value);

  if (map.containsKey(keyVarClassName) && !map.containsKey('__type')) {
    final String className = map[keyVarClassName] as String;
    switch (className) {
      case 'GeoPoint':
        return _geoFrom(map);
      case keyFileClassname:
        return ParseCoreData.instance
            .createFile(name: map[keyVarName] as String?, url: map[keyVarURL] as String?)
            .fromJson(map);
      default:
        return ParseCoreData.instance
            .createObject(className)
            .fromJson(map..remove(keyVarClassName));
    }
  }

  if (!map.containsKey('__type')) {
    final Map<String, dynamic> out = <String, dynamic>{};
    map.forEach((String key, dynamic v) => out[key] = parseDecode(v));
    return out;
  }

  switch (map['__type']) {
    case 'Date':
      return parseParseDate(map['iso']);
    case 'Bytes':
      return base64Decode(map['base64'] as String);
    case 'Pointer':
      final String className = map[keyVarClassName] as String;
      final ParseObject object = ParseCoreData.instance.createObject(className);
      object.setObjectIdUnsafe(map[keyVarObjectId] as String?);
      if (map.containsKey(keyVarCreatedAt)) {
        object.fromJson(<String, dynamic>{
          keyVarCreatedAt: map[keyVarCreatedAt],
          keyVarUpdatedAt: map[keyVarUpdatedAt],
        });
      }
      return object;
    case 'Object':
      final String className = map[keyVarClassName] as String;
      return ParseCoreData.instance
          .createObject(className)
          .fromJson(map..remove('__type'));
    case 'File':
      return ParseCoreData.instance
          .createFile(
              name: map[keyVarName] as String?,
              url: absoluteFileUrl(map[keyVarURL] as String?))
          .fromJson(map..remove('__type'));
    case 'GeoPoint':
      return _geoFrom(map);
    case 'Relation':
      return ParseRelation.fromJson(map);
  }
  return map;
}

ParseGeoPoint _geoFrom(Map<String, dynamic> map) => ParseGeoPoint(
      latitude: (map['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (map['longitude'] as num?)?.toDouble() ?? 0.0,
    );

/// The backend serves uploads as `/uploads/x.png`; widgets need a full URL.
String? absoluteFileUrl(String? url) {
  if (url == null || url.isEmpty) return url;
  if (url.startsWith('http')) return url;
  final String base = ParseCoreData.instance.serverUrl;
  final Uri? parsed = Uri.tryParse(base);
  if (parsed == null || parsed.host.isEmpty) return url;
  return '${parsed.scheme}://${parsed.authority}'
      '${url.startsWith('/') ? url : '/$url'}';
}
