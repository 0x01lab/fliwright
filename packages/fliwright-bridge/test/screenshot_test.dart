import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  testWidgets('default capture waits for pending widget changes to paint',
      (tester) async {
    late StateSetter update;
    var builds = 0;
    await tester.pumpWidget(StatefulBuilder(builder: (context, setState) {
      update = setState;
      builds++;
      return const SizedBox();
    }));
    update(() {});
    final registry = ExtensionRegistry();
    ScreenshotExtension.register(registry);
    var completed = false;
    final pending =
        registry.invoke('ext.fliwright.screenshot', {}).then((result) {
      completed = true;
      return result;
    });
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    expect(completed, isFalse,
        reason:
            'A screenshot must wait for the pending frame, not publish the old scene.');
    await tester.pump();
    final result = await tester.runAsync(() => pending);
    expect(builds, 2);
    expect(result!['success'], isTrue);
  });

  testWidgets('viewport capture never selects a nested route repaint boundary',
      (tester) async {
    final probe = _BoundaryProbe();
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: Center(child: SizedBox(width: 40, height: 30, child: probe))));
    final registry = ExtensionRegistry();
    ScreenshotExtension.register(registry);
    final result = await tester.runAsync(() =>
        registry.invoke('ext.fliwright.screenshot', {'waitForFrame': 'false'}));
    expect(probe.renderObject.captureCount, 0);
    expect(result!['success'], isTrue);
    expect(result['width'],
        tester.view.physicalSize.width / tester.view.devicePixelRatio);
    expect(result['height'],
        tester.view.physicalSize.height / tester.view.devicePixelRatio);
  });

  testWidgets(
    'screenshot captures the current render view at requested ratio',
    // flutter_test's headless renderer returns transparent pixels for scenes.
    // Pixel content is additionally checked against the real macOS fixture.
    skip: true,
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

      await tester.runAsync(() async {
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
        expect(centerPixel.a, 1.0);
        expect(centerPixel.g, greaterThan(100 / 255));
        expect(centerPixel.r, lessThan(100 / 255));
      });
    },
  );
}

class _BoundaryProbe extends LeafRenderObjectWidget {
  final renderObject = _ProbeRepaintBoundary();
  @override
  RenderObject createRenderObject(BuildContext context) => renderObject;
}

class _ProbeRepaintBoundary extends RenderRepaintBoundary {
  int captureCount = 0;
  @override
  Future<ui.Image> toImage({double pixelRatio = 1.0}) {
    captureCount++;
    return super.toImage(pixelRatio: pixelRatio);
  }
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
