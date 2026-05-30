import 'dart:io';

class FliwrightHttpOverrides extends HttpOverrides {
  final int _mockPort;

  FliwrightHttpOverrides._(this._mockPort);

  static void install({required int port}) {
    HttpOverrides.global = FliwrightHttpOverrides._(port);
  }
}
