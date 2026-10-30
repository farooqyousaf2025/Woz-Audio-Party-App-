part of woz_parse;

/// Builds Parse-style constraints and translates them into woz-backend query
/// parameters. Conditions are kept as a structured map instead of the string
/// fragments the old SDK concatenated, so nested `$or`/`$and` stay exact.
class QueryBuilder<T extends ParseObject> {
  QueryBuilder(this.object);

  factory QueryBuilder.name(String classname) =>
      QueryBuilder<T>(ParseCoreData.instance.createObject(classname) as T);

  QueryBuilder.or(this.object, List<QueryBuilder<T>> list) {
    _where[r'$or'] = list.map((QueryBuilder<T> q) => q._where).toList();
  }

  QueryBuilder.and(this.object, List<QueryBuilder<T>> list) {
    _where[r'$and'] = list.map((QueryBuilder<T> q) => q._where).toList();
  }

  QueryBuilder.nor(this.object, List<QueryBuilder<T>> list) {
    _where[r'$nor'] = list.map((QueryBuilder<T> q) => q._where).toList();
  }

  /// Deep copy so a caller can tweak limit/order without touching the original.
  static QueryBuilder<T> copy<T extends ParseObject>(QueryBuilder<T> query) {
    final QueryBuilder<T> copy = QueryBuilder<T>(query.object)
      .._where = _cloneMap(query._where);
    copy._limiters.addAll(query._limiters);
    copy._extraOptions.addAll(query._extraOptions);
    return copy;
  }

  static Map<String, dynamic> _cloneMap(Map<String, dynamic> source) {
    return Map<String, dynamic>.from(
        jsonDecode(jsonEncode(source, toEncodable: _encodeForQuery)) as Map);
  }

  final ParseObject object;
  Map<String, dynamic> _where = <String, dynamic>{};
  final Map<String, dynamic> _limiters = <String, dynamic>{};
  final Map<String, dynamic> _extraOptions = <String, dynamic>{};

  String get className => object.parseClassName;

  Map<String, dynamic> get conditions => _where;

  Map<String, dynamic> get limiters => _limiters;

  void _merge(String column, String operator, dynamic value) {
    final dynamic existing = _where[column];
    if (existing is Map<String, dynamic> && _isOperatorMap(existing)) {
      existing[operator] = value;
    } else {
      _where[column] = <String, dynamic>{operator: value};
    }
  }

  static bool _isOperatorMap(Map<String, dynamic> map) =>
      map.keys.every((String key) => key.startsWith(r'$'));

  void setRedirectClassNameForKey(String key) {
    _extraOptions['redirectClassNameForKey'] = key;
  }

  void setLimit(int limit) => _limiters['limit'] = limit;

  void setAmountToSkip(int skip) => _limiters['skip'] = skip;

  void whereEquals(String where) {
    final dynamic decoded = jsonDecode(where);
    if (decoded is Map) {
      _where = Map<String, dynamic>.from(decoded as Map<String, dynamic>);
    }
  }

  void orderByAscending(String order) => _appendOrder(order, false);

  void orderByDescending(String order) => _appendOrder(order, true);

  void _appendOrder(String order, bool descending) {
    final String key = descending ? '-$order' : order;
    final dynamic existing = _limiters['order'];
    _limiters['order'] = existing == null ? key : '$existing,$key';
  }

  void keysToReturn(List<String> keys) => _limiters['keys'] = keys.join(',');

  void excludeKeys(List<String> keys) {
    // The backend has no field-exclusion limiter; the caller receives the
    // unused fields instead of the query failing.
    _limiters.remove('keys');
  }

  void includeObject(List<String> objectTypes) {
    final dynamic existing = _limiters['include'];
    final String joined = objectTypes.join(',');
    _limiters['include'] =
        existing == null ? joined : '$existing,$joined';
  }

  void whereEqualTo(String column, dynamic value) {
    _where[column] = _encodeForQuery(value);
  }

  void whereLessThan(String column, dynamic value) =>
      _merge(column, r'$lt', _encodeForQuery(value));

  void whereLessThanOrEqualTo(String column, dynamic value) =>
      _merge(column, r'$lte', _encodeForQuery(value));

  void whereGreaterThan(String column, dynamic value) =>
      _merge(column, r'$gt', _encodeForQuery(value));

  void whereGreaterThanOrEqualsTo(String column, dynamic value) =>
      _merge(column, r'$gte', _encodeForQuery(value));

  void whereNotEqualTo(String column, dynamic value) =>
      _merge(column, r'$ne', _encodeForQuery(value));

  void whereContainedIn(String column, List<dynamic> value) =>
      _merge(column, r'$in', value.map(_encodeForQuery).toList());

  void whereNotContainedIn(String column, List<dynamic> value) =>
      _merge(column, r'$nin', value.map(_encodeForQuery).toList());

  void whereValueExists(String column, bool value) =>
      _merge(column, r'$exists', value);

  void whereRelatedTo(String column, String className, String objectId) {
    _where[r'$relatedTo'] = <String, dynamic>{
      'object': <String, dynamic>{
        '__type': 'Pointer',
        'className': className,
        'objectId': objectId
      },
      'key': column
    };
  }

  void selectKeys(String column, dynamic value) =>
      _merge(column, r'$select', value);

  void dontSelectKeys(String column, dynamic value) =>
      _merge(column, r'$dontSelect', value);

  void whereArrayContainsAll(String column, List<dynamic> value) =>
      _merge(column, r'$all', value.map(_encodeForQuery).toList());

  void regEx(String column, String value, {String? options}) {
    _merge(column, r'$regex', value);
    if (options != null) _merge(column, r'$options', options);
  }

  static String _literalRegex(String text, {String prefix = '', String suffix = ''}) =>
      '$prefix\\Q$text\\E$suffix';

  void whereStartsWith(String column, String prefix,
          {bool caseSensitive = false}) =>
      regEx(column, _literalRegex(prefix, prefix: '^'),
          options: caseSensitive ? null : 'i');

  void whereEndsWith(String column, String suffix,
          {bool caseSensitive = false}) =>
      regEx(column, _literalRegex(suffix, suffix: r'$'),
          options: caseSensitive ? null : 'i');

  void whereContains(String column, String substring,
          {bool caseSensitive = false}) =>
      regEx(column, _literalRegex(substring),
          options: caseSensitive ? null : 'i');

  void whereContainsWholeWord(String column, String searchTerm,
          {bool caseSensitive = false,
          bool diacriticSensitive = false,
          bool orderByScore = true}) {
    regEx(column, r'\b' + _literalRegex(searchTerm) + r'\b',
        options: caseSensitive ? null : 'i');
  }

  void whereNear(String column, ParseGeoPoint point) => _merge(
      column,
      r'$nearSphere',
      <String, dynamic>{
        '__type': 'GeoPoint',
        'latitude': point.latitude,
        'longitude': point.longitude
      });

  void whereWithinMiles(String column, ParseGeoPoint point, double maxDistance) =>
      _merge(column, r'$maxDistanceInMiles', maxDistance);

  void whereWithinKilometers(
          String column, ParseGeoPoint point, double maxDistance) =>
      _merge(column, r'$maxDistanceInKilometers', maxDistance);

  void whereWithinRadians(String column, ParseGeoPoint point, double maxDistance) =>
      _merge(column, r'$maxDistanceInRadians', maxDistance);

  void whereWithinGeoBox(
          String column, ParseGeoPoint southwest, ParseGeoPoint northeast) =>
      _merge(column, r'$within', <String, dynamic>{
        r'$box': <dynamic>[southwest.toJson(), northeast.toJson()]
      });

  void whereWithinPolygon(String column, List<ParseGeoPoint> points) {
    if (points.length < 3) throw ArgumentError('Polygon must have at least 3 points');
    _merge(column, r'$within', <String, dynamic>{
      r'$polygon': points.map((ParseGeoPoint p) => p.toJson()).toList()
    });
  }

  void wherePolygonContains(String column, ParseGeoPoint point) =>
      _merge(column, r'$geoIntersects', <String, dynamic>{
        r'$point': point.toJson()
      });

  Map<String, dynamic> _subQuery<E extends ParseObject>(
      String column, String keyInQuery, QueryBuilder<E> query, String operator) {
    final Map<String, dynamic> spec = <String, dynamic>{
      'className': query.object.parseClassName,
      'where': query._where,
      if (keyInQuery.isNotEmpty) 'key': keyInQuery,
    };
    _merge(column, operator, spec);
    return spec;
  }

  void whereMatchesQuery<E extends ParseObject>(
          String column, QueryBuilder<E> query) =>
      _subQuery<E>(column, 'objectId', query, r'$inQuery');

  void whereDoesNotMatchQuery<E extends ParseObject>(
          String column, QueryBuilder<E> query) =>
      _subQuery<E>(column, 'objectId', query, r'$notInQuery');

  void whereMatchesKeyInQuery<E extends ParseObject>(
      String column, String keyInQuery, QueryBuilder<E> query) {
    if (query._where.isEmpty) throw ArgumentError('query conditions is required');
    if (query._limiters.containsKey('order')) {
      throw ArgumentError('order is not allowed');
    }
    if (query._limiters.containsKey('include')) {
      throw ArgumentError('include is not allowed');
    }
    _subQuery<E>(column, keyInQuery, query, r'$select');
  }

  void whereDoesNotMatchKeyInQuery<E extends ParseObject>(
      String column, String keyInQuery, QueryBuilder<E> query) {
    if (query._where.isEmpty) throw ArgumentError('query conditions is required');
    if (query._limiters.containsKey('order')) {
      throw ArgumentError('order is not allowed');
    }
    if (query._limiters.containsKey('include')) {
      throw ArgumentError('include is not allowed');
    }
    _subQuery<E>(column, keyInQuery, query, r'$dontSelect');
  }

  /// Query parameters for `GET /classes/:name`.
  Map<String, dynamic> toQueryParameters({bool count = false}) {
    final Map<String, dynamic> params = <String, dynamic>{
      'where': jsonEncode(_where, toEncodable: _encodeForQuery),
    };
    params.addAll(_limiters);
    if (count) params['count'] = '1';
    params.addAll(_extraOptions);
    return params;
  }

  String buildQuery() {
    final StringBuffer buffer =
        StringBuffer('where=${jsonEncode(_where, toEncodable: _encodeForQuery)}');
    _limiters.forEach((String key, dynamic value) => buffer.write('&$key=$value'));
    _extraOptions.forEach((String key, dynamic value) => buffer.write('&$key=$value'));
    return buffer.toString();
  }

  String _buildQueryCount() => '${buildQuery()}&count=1';

  Future<ParseResponse> query<U extends ParseObject>(
      {ProgressCallback? progressCallback}) async {
    return object.query<U>(buildQuery(), progressCallback: progressCallback);
  }

  Future<ParseResponse> count() async => object.query(_buildQueryCount());

  Future<ParseResponse> distinct<U extends ParseObject>(String className) async =>
      object.distinct<U>('distinct=$className');

  /// Returns the first match or null. Throws the server error otherwise.
  Future<T?> first() async {
    final ParseResponse response =
        await (QueryBuilder.copy(this)..setLimit(1)).query<T>();
    if (response.success) {
      final List? results = response.results;
      if (results == null || results.isEmpty) return null;
      return results.first as T;
    }
    throw response.error ?? ParseError();
  }

  Future<List<T>> find() async {
    final ParseResponse response = await query<T>();
    if (response.success) {
      return response.results?.map((dynamic e) => e as T).toList() ?? <T>[];
    }
    throw response.error ?? ParseError();
  }
}

/// Values placed inside a `where` clause use the REST encoding, with dates as
/// plain ISO strings because that is how the backend stores them.
dynamic _encodeForQuery(dynamic value) {
  if (value is DateTime) return formatParseDate(value.toUtc());
  if (value is ParseObject) {
    if (value.objectId == null) return null;
    return <String, dynamic>{
      '__type': 'Pointer',
      keyVarClassName: value.parseClassName,
      keyVarObjectId: value.objectId,
    };
  }
  if (value is ParseFileBase) {
    return <String, dynamic>{
      '__type': 'File',
      keyVarName: value.name,
      keyVarURL: value.url,
    };
  }
  if (value is ParseGeoPoint) return value.toJson();
  if (value is List) return value.map<dynamic>(_encodeForQuery).toList();
  if (value is Map) {
    return <String, dynamic>{
      for (final MapEntry<String, dynamic> entry
          in value.cast<String, dynamic>().entries)
        entry.key: _encodeForQuery(entry.value)
    };
  }
  return value;
}
