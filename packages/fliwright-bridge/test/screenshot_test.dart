import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/screenshot.dart';

void main() {
  testWidgets(
    'screenshot captures the current render view at requested ratio',
    (tester) async {
      tester.view.devicePixelRatio = 3.0;
      tester.view.physicalSize = const Size(900, 1800);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetPhysicalSize);

      final registry = ExtensionRegistry();
      ScreenshotExtension.register(registry);

      await tester.pumpWidget(
        MaterialApp(
          home: const _ColoredScreen(color: Colors.red),
          routes: {'/next': (_) => const _ColoredScreen(color: Colors.green)},
        ),
      );
      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();

      final result = await registry.invoke('ext.fliwright.screenshot', {
        'pixelRatio': '1.0',
        'waitForFrame': 'false',
      });

      expect(result['success'], isTrue);
      expect(result['width'], 300.0);
      expect(result['height'], 600.0);
      expect(result['pixelRatio'], 1.0);

      final bytes = base64Decode(result['screenshot'] as String);
      final codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      final image = frame.image;
      addTearDown(image.dispose);

      expect(image.width, 300);
      expect(image.height, 600);

      final centerPixel = await _pixelAt(image, 150, 300);
      expect(centerPixel.alpha, 255);
      expect(centerPixel.green, greaterThan(100));
      expect(centerPixel.red, lessThan(100));
    },
  );
}

class _ColoredScreen extends StatelessWidget {
  const _ColoredScreen({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: color,
      child: Center(
        child: TextButton(
          onPressed: () => Navigator.of(context).pushNamed('/next'),
          child: const Text('Next'),
        ),
      ),
    );
  }
}

Future<Color> _pixelAt(ui.Image image, int x, int y) async {
  final byteData = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
  final bytes = byteData!.buffer.asUint8List();
  final offset = ((y * image.width) + x) * 4;
  return Color.fromARGB(
    bytes[offset + 3],
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
  );
}
