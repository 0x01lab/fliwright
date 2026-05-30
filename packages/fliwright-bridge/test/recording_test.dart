import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('RecordingExtension', () {
    setUp(() async {
      await FliwrightBridge.reset();
    });

    test('registers startRecording and stopRecording on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.startRecording'));
      expect(methods, contains('ext.fliwright.stopRecording'));
    });

    test('registers hitTest extension on init', () async {
      await FliwrightBridge.init();
      expect(FliwrightBridge.registry.registeredMethods,
          contains('ext.fliwright.hitTest'));
    });

    test('startRecording returns recording=true', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.startRecording', {});
      expect(result['recording'], isTrue);
    });

    test('stopRecording returns recording=false after start', () async {
      await FliwrightBridge.init();
      await FliwrightBridge.registry.invoke('ext.fliwright.startRecording', {});
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.stopRecording', {});
      expect(result['recording'], isFalse);
    });

    test('hitTest returns widget map', () async {
      TestWidgetsFlutterBinding.ensureInitialized();
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry
          .invoke('ext.fliwright.hitTest', {'x': '100', 'y': '200'});
      expect(result, contains('widget'));
    });
  });
}
