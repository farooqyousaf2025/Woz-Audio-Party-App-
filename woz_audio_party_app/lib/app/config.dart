import 'dart:ui';


class Config {

  static const String packageNameAndroid = "com.woz.audioparty";
  static const String packageNameiOS = "com.woz.audioparty";
  static const String iosAppStoreId = "1048";
  static final String appName = "Woz Audio Party App";
  static final String appVersion = "1.0.0";
  static final String companyName = "Woz";
  static final String appOrCompanyUrl = "https://woz-audio-party.web.app";
  static final String initialCountry = 'AO'; // United States

  static final String serverUrl = "http://10.0.2.2:8090/api";
  static final String liveQueryUrl = "ws://10.0.2.2:8090/ws";
  static final String appId = "woz-local-app-id";
  static final String clientKey = "";

  //OneSignal
  static final String oneSignalAppId = "";

  // Firebase Cloud Messaging
  static final String pushGcm = "";
  static final String webPushCertificate = "";

  // User support objectId
  static final String supportId = "";

  // Play Store and App Store public keys
  static final String publicGoogleSdkKey = "";
  static final String publicIosSdkKey = "";

  // Languages
  static String defaultLanguage = "en"; // English is default language.
  static List<Locale> languages = [
    Locale(defaultLanguage),
    //Locale('pt'),
    //Locale('fr')
  ];

  // Android Admob ad
  static const String admobAndroidOpenAppAd = "ca-app-pub-9318890613494690/4325316561";
  static const String admobAndroidHomeBannerAd = "ca-app-pub-9318890613494690/8240828077";
  static const String admobAndroidFeedNativeAd = "ca-app-pub-9318890613494690/9362338057";
  static const String admobAndroidChatListBannerAd = "ca-app-pub-9318890613494690/6736174716";
  static const String admobAndroidLiveBannerAd = "ca-app-pub-9318890613494690/7959371442";
  static const String admobAndroidFeedBannerAd = "ca-app-pub-9318890613494690/9362338057";

  // iOS Admob ad
  static const String admobIOSOpenAppAd = "ca-app-pub-1084112649181796/6328973508";
  static const String admobIOSHomeBannerAd = "ca-app-pub-1084112649181796/1185447057";
  static const String admobIOSFeedNativeAd = "ca-app-pub-1084112649181796/7224203806";
  static const String admobIOSChatListBannerAd = "ca-app-pub-1084112649181796/5811376758";
  static const String admobIOSLiveBannerAd = "ca-app-pub-1084112649181796/8093979063";
  static const String admobIOSFeedBannerAd = "ca-app-pub-1084112649181796/6907075815";

  // Web links for help, privacy policy and terms of use.
  static final String helpCenterUrl = "https://woz-audio-party.web.app/terms/";
  static final String privacyPolicyUrl = "https://woz-audio-party.web.app/privacy/";
  static final String termsOfUseUrl = "https://woz-audio-party.web.app/terms/";
  static final String termsOfUseInAppUrl = "https://woz-audio-party.web.app/terms/";
  static final String dataSafetyUrl = "https://ladylivea.net/help.hmtl";
  static final String openSourceUrl = "https://www.ladylivea.net/third-party-license.html";
  static final String instructionsUrl = "https://ladylivea.net/instructions.hmtl";
  static final String cashOutUrl = "https://ladylivea.net/cashout.hmtl";
  static final String supportUrl = "https://www.ladylivea.net/support";
  static final String liveAgreementUrl = "https://woz-audio-party.web.app/live/";
  static final String userAgreementUrl = "https://woz-audio-party.web.app/user/";

  // Google Play and Apple Pay In-app Purchases IDs
  static final String credit100 = "woz.100.credits";
  static final String credit200 = "woz.200.credits";
  static final String credit500 = "woz.500.credits";
  static final String credit1000 = "woz.1000.credits";
  static final String credit2100 = "woz.2100.credits";
  static final String credit5250 = "woz.5250.credits";
  static final String credit10500 = "woz.10500.credits";
}