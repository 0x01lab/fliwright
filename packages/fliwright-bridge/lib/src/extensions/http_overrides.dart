import 'dart:io';

class FliwrightHttpOverrides extends HttpOverrides {
  final int mockPort;

  FliwrightHttpOverrides._(this.mockPort);

  static void install({required int port}) {
    HttpOverrides.global = FliwrightHttpOverrides._(port);
  }
}
