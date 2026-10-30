/// A drop-in replacement for the Parse Server Dart SDK, backed by the Woz
/// backend (`woz_backend`) over REST + WebSocket.
///
/// The public names and signatures mirror parse_server_sdk 6.4.0 so the
/// application layer did not have to be rewritten; the transport, storage and
/// LiveQuery protocol are the project's own.
library woz_parse;

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:universal_io/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

part 'src/core.dart';
part 'src/serialization.dart';
part 'src/object.dart';
part 'src/query.dart';
part 'src/objects.dart';
part 'src/live.dart';

/// True when compiled for the web; mirrors `kIsWeb` without pulling Flutter in.
const bool parseIsWeb = identical(0, 0.0);

class Parse {
  bool _hasBeenInitialized = false;

  static bool objectsExistForEventually = false;

  Future<Parse> initialize(
    String appId,
    String serverUrl, {
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
    dynamic securityContext,
    CoreStore? coreStore,
    Map<String, ParseObjectConstructor>? registeredSubClassMap,
    ParseUserConstructor? parseUserConstructor,
    ParseFileConstructor? parseFileConstructor,
    List<int>? liveListRetryIntervals,
    dynamic connectivityProvider,
    String? fileDirectory,
    Stream<void>? appResumedStream,
    dynamic clientCreator,
  }) async {
    ParseCoreData.init(
      appId,
      serverUrl.endsWith('/') ? serverUrl.substring(0, serverUrl.length - 1) : serverUrl,
      debug: debug,
      appName: appName,
      appVersion: appVersion,
      appPackageName: appPackageName,
      locale: locale,
      liveQueryUrl: liveQueryUrl,
      masterKey: masterKey,
      clientKey: clientKey,
      sessionId: sessionId,
      autoSendSessionId: autoSendSessionId,
      store: coreStore,
      registeredSubClassMap: registeredSubClassMap,
      parseUserConstructor: parseUserConstructor,
      parseFileConstructor: parseFileConstructor,
    );

    _hasBeenInitialized = true;
    await LiveQueryClient.instance.reconnect();
    return this;
  }

  bool hasParseBeenInitialized() => _hasBeenInitialized;

  Future<ParseResponse> healthCheck(
      {bool? debug, dynamic client, bool? sendSessionIdByDefault}) async {
    try {
      final ParseNetworkResponse response =
          await WozRest(sendSessionId: false).get('/health');
      return handleResponse<Parse>(
          null, response, ParseApiRQ.healthCheck, returnAsBaseResult: true);
    } on Exception catch (e) {
      return handleException(e, ParseApiRQ.healthCheck,
          debug ?? ParseCoreData.instance.debug, 'parseBase');
    }
  }
}
