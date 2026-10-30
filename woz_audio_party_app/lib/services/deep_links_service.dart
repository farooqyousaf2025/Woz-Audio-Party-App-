import '../app/Config.dart';

class DeepLinksService {
  static const String keyPostShare = "post_share";
  static const String keyProfileShare = "profile_share";
  static const String keyEventShare = "event_share";

  static Future<String> createLink({
    required String shareAction,
    required String objectID,
  }) async {
    return Uri.parse(Config.appOrCompanyUrl)
        .replace(queryParameters: {
          "share_action": shareAction,
          "object_id": objectID,
        })
        .toString();
  }
}
