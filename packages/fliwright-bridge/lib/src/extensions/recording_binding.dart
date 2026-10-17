import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

/// Flutter binding that exposes the pointer hit-test path before dispatch.
///
/// Apps that need reliable manual recording must construct this binding before
/// `runApp`. It cannot replace a binding initialized by another package.
class FliwrightRecordingBinding extends WidgetsFlutterBinding {
  /// Querying capabilities must also work before a widget binding exists.
  static bool get isInstalled {
    try {
      return WidgetsBinding.instance is FliwrightRecordingBinding;
    } on FlutterError {
      return false;
    } on TypeError {
      // The instance getter uses a null assertion in non-debug builds.
      return false;
    }
  }

  static void Function(PointerEvent event, HitTestResult? result)?
      beforePointerDispatch;

  /// Recording-only observer; assigning null releases it at stop/reset.
  static VoidCallback? afterFrame;

  @override
  void drawFrame() {
    super.drawFrame();
    afterFrame?.call();
  }

  static FliwrightRecordingBinding ensureInitialized() {
    try {
      final existing = WidgetsBinding.instance;
      if (existing is FliwrightRecordingBinding) return existing;
      throw StateError(
        'Fliwright recording requires FliwrightRecordingBinding to be '
        'initialized before the app binding.',
      );
    } on FlutterError {
      return FliwrightRecordingBinding();
    }
  }

  @override
  void dispatchEvent(PointerEvent event, HitTestResult? hitTestResult) {
    beforePointerDispatch?.call(event, hitTestResult);
    super.dispatchEvent(event, hitTestResult);
  }
}
