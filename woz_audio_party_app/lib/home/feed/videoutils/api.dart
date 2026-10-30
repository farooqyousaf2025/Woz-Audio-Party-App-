import 'package:woz_audio_party_app/home/feed/videoutils/video.dart';

abstract class VideoNewFeedApi<V extends VideoInfo> {
  Future<List<V>> getListVideo();

  Future<List<V>> loadMore(List<V> currentList);
}