import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';

void main() {
  testWidgets(
      'long capture excludes floating bottom tabs and retains covered rows',
      (tester) async {
    await tester.pumpWidget(const Directionality(
        textDirection: TextDirection.ltr,
        child: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
                width: 200,
                height: 200,
                child: Stack(children: [
                  SingleChildScrollView(
                      child: Column(children: [
                    ColoredBox(
                        color: Color(0xff00ff00),
                        child: SizedBox(width: 200, height: 200)),
                    ColoredBox(
                        color: Color(0xff0000ff),
                        child: SizedBox(width: 200, height: 200)),
                    ColoredBox(
                        color: Color(0xffffff00),
                        child: SizedBox(width: 200, height: 150)),
                  ])),
                  Positioned(
                      bottom: 20,
                      left: 30,
                      right: 30,
                      height: 40,
                      child: ColoredBox(color: Color(0xffff0000))),
                ])))));
    final position =
        tester.state<ScrollableState>(find.byType(Scrollable)).position;
    position.jumpTo(75);
    await tester.pump();
    // Ordinary screenshots must still include the floating tab bar.
    final registry = ExtensionRegistry();
    ScreenshotExtension.register(registry);
    await tester.runAsync(() async {
      final screen = await registry
          .invoke('ext.fliwright.screenshot', {'waitForFrame': 'false'});
      final codec = await ui
          .instantiateImageCodec(base64Decode(screen['screenshot'] as String));
      final frame = await codec.getNextFrame();
      try {
        expect(await _pixelAt(frame.image, 100, 150), const Color(0xffff0000));
      } finally {
        frame.image.dispose();
        codec.dispose();
      }
    });
    final result = await _captureFullPage(tester);
    expect(result['success'], isTrue, reason: result['error']?.toString());
    expect(result['height'], 550);
    await tester.runAsync(() async {
      final codec = await ui
          .instantiateImageCodec(base64Decode(result['screenshot'] as String));
      final frame = await codec.getNextFrame();
      try {
        // Sample every row, including the floating bar's positions and both seams.
        final data =
            await frame.image.toByteData(format: ui.ImageByteFormat.rawRgba);
        final bytes = data!.buffer.asUint8List();
        for (var y = 0; y < 550; y++) {
          final offset = (y * frame.image.width + 100) * 4;
          final expected = y < 200
              ? [0, 255, 0, 255]
              : y < 400
                  ? [0, 0, 255, 255]
                  : [255, 255, 0, 255];
          expect(bytes.sublist(offset, offset + 4), expected,
              reason:
                  'Content row $y must survive without the bottom tab overlay');
        }
      } finally {
        frame.image.dispose();
        codec.dispose();
      }
    });
    expect(position.pixels, 75);
  });

  testWidgets(
      'lazy viewport capture excludes sibling overlays at a fractional ratio',
      (tester) async {
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
                width: 200,
                height: 200,
                child: Stack(children: [
                  ListView.builder(
                      itemCount: 11,
                      itemExtent: 50,
                      itemBuilder: (_, index) => ColoredBox(
                          color: index.isEven
                              ? const Color(0xff00ff00)
                              : const Color(0xff0000ff))),
                  const Positioned(
                      bottom: 20,
                      left: 30,
                      right: 30,
                      height: 40,
                      child: ColoredBox(color: Color(0xffff0000))),
                ])))));
    final result = await _captureFullPage(tester, {'pixelRatio': '1.5'});
    expect(result['success'], isTrue, reason: result['error']?.toString());
    await tester.runAsync(() async {
      final codec = await ui
          .instantiateImageCodec(base64Decode(result['screenshot'] as String));
      final frame = await codec.getNextFrame();
      try {
        expect(frame.image.width, 300);
        expect(frame.image.height, 825);
        final data =
            await frame.image.toByteData(format: ui.ImageByteFormat.rawRgba);
        final bytes = data!.buffer.asUint8List();
        for (var y = 0; y < 825; y++) {
          final offset = (y * frame.image.width + 150) * 4;
          expect(bytes.sublist(offset, offset + 4),
              (y ~/ 75).isEven ? [0, 255, 0, 255] : [0, 0, 255, 255],
              reason:
                  'Lazy list pixel row $y must contain content, including seams and formerly covered areas');
        }
      } finally {
        frame.image.dispose();
        codec.dispose();
      }
    });
  });

  testWidgets('full-page renders lazy list content beyond the initial viewport',
      (tester) async {
    final built = <int>{};
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
                width: 200,
                height: 200,
                child: ListView.builder(
                    itemCount: 20,
                    itemExtent: 100,
                    itemBuilder: (_, index) {
                      built.add(index);
                      return Text('Row $index');
                    })))));
    expect(built, isNot(contains(19)));
    final result = await _captureFullPage(tester);
    expect(result['success'], isTrue, reason: result['error']?.toString());
    expect(result['height'], 2000);
    expect(built, contains(19));
    expect(
        tester.state<ScrollableState>(find.byType(Scrollable)).position.pixels,
        0);
  });

  testWidgets(
      'multiple scroll views require a selector and capture only its target',
      (tester) async {
    await tester.pumpWidget(const Directionality(
        textDirection: TextDirection.ltr,
        child: Row(children: [
          Expanded(
              child: SingleChildScrollView(
                  key: ValueKey('left'), child: SizedBox(height: 1200))),
          Expanded(
              child: SingleChildScrollView(
                  key: ValueKey('right'), child: SizedBox(height: 1800))),
        ])));
    final ambiguous = await _captureFullPage(tester);
    expect(ambiguous['success'], isFalse);
    expect(ambiguous['error'], contains('Multiple'));
    final selected =
        await _captureFullPage(tester, {'scrollable': 'key=right'});
    expect(selected['success'], isTrue, reason: selected['error']?.toString());
    expect(selected['height'], 1800);
    expect(selected['width'], 400);
    final missing =
        await _captureFullPage(tester, {'scrollable': 'key=missing'});
    expect(missing['success'], isFalse);
  });

  testWidgets('reverse and horizontal scroll views fail explicitly',
      (tester) async {
    for (final axis in [Axis.vertical, Axis.horizontal]) {
      await tester.pumpWidget(Directionality(
          textDirection: TextDirection.ltr,
          child: SingleChildScrollView(
              scrollDirection: axis,
              reverse: axis == Axis.vertical,
              child: const SizedBox(width: 2000, height: 2000))));
      final result = await _captureFullPage(tester);
      expect(result['success'], isFalse);
      expect(result['error'], contains('non-reversed vertical'));
    }
  });

  testWidgets('non-scrollable pages still return a single PNG', (tester) async {
    await tester.pumpWidget(const SizedBox());
    final result = await _captureFullPage(tester);
    expect(result['success'], isTrue);
    expect(result['screenshot'], isA<String>());
    expect(result['height'], 600);
  });

  testWidgets(
      'sticky headers fail explicitly instead of appearing in every segment',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: CustomScrollView(slivers: [
      const SliverAppBar(pinned: true, title: Text('Sticky')),
      SliverFixedExtentList(
          itemExtent: 100,
          delegate: SliverChildBuilderDelegate((_, index) => Text('Row $index'),
              childCount: 20)),
    ])));
    final result = await _captureFullPage(tester);
    expect(result['success'], isFalse);
    expect(result['error'], contains('Sticky or floating headers'));
  });

  testWidgets('image pixel limit fails before allocating and preserves offset',
      (tester) async {
    await tester.pumpWidget(const Directionality(
        textDirection: TextDirection.ltr,
        child: SingleChildScrollView(child: SizedBox(height: 2000))));
    final position =
        tester.state<ScrollableState>(find.byType(Scrollable)).position;
    position.jumpTo(50);
    await tester.pump();
    final result = await _captureFullPage(tester, {'pixelRatio': '100'});
    expect(result['success'], isFalse);
    expect(result['error'], contains('image size limit'));
    expect(position.pixels, 50);
  });

  testWidgets(
      'full-page stitches a controller-free list and restores its offset',
      (tester) async {
    await tester.pumpWidget(const Directionality(
      textDirection: TextDirection.ltr,
      child: Align(
          alignment: Alignment.topLeft,
          child: SizedBox(
              width: 200,
              height: 200,
              child: SingleChildScrollView(child: SizedBox(height: 550)))),
    ));
    final state = tester.state<ScrollableState>(find.byType(Scrollable));
    state.position.jumpTo(75);
    await tester.pump();
    final offsets = <double>[];
    state.position.addListener(() => offsets.add(state.position.pixels));
    final registry = ExtensionRegistry();
    ScreenshotExtension.register(registry);
    Map<String, dynamic>? result;
    late Future<void> pending;
    await tester.runAsync(() async {
      pending = registry.invoke('ext.fliwright.screenshot',
          {'fullPage': 'true', 'pixelRatio': '1.5'}).then((value) {
        result = value;
      });
    });
    for (var i = 0; i < 40 && result == null; i++) {
      await tester.pump();
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)));
    }
    expect(result, isNotNull);
    await tester.runAsync(() => pending);
    expect(result!['success'], isTrue, reason: result!['error']?.toString());
    expect(result!['width'], 200);
    expect(result!['height'], 550);
    expect(result!['segments'], isNull);
    final codec = await tester.runAsync(() => ui
        .instantiateImageCodec(base64Decode(result!['screenshot'] as String)));
    final frame = await tester.runAsync(() => codec!.getNextFrame());
    expect(frame!.image.width, 300);
    expect(frame.image.height, 825);
    frame.image.dispose();
    codec!.dispose();
    expect(offsets, containsAllInOrder([0, 200, 350, 75]));
    expect(state.position.pixels, 75);
  });

  testWidgets('full-page height limit fails and restores the original position',
      (tester) async {
    final controller = ScrollController(initialScrollOffset: 50);
    addTearDown(controller.dispose);
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: SingleChildScrollView(
            controller: controller, child: const SizedBox(height: 2000))));
    final registry = ExtensionRegistry();
    ScreenshotExtension.register(registry);
    Map<String, dynamic>? result;
    late Future<void> pending;
    await tester.runAsync(() async {
      pending = registry.invoke('ext.fliwright.screenshot',
          {'fullPage': 'true', 'maxHeight': '500'}).then((value) {
        result = value;
      });
    });
    for (var i = 0; i < 40 && result == null; i++) {
      await tester.pump();
      await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 10)));
    }
    expect(result, isNotNull);
    await tester.runAsync(() => pending);
    expect(result!['success'], isFalse);
    expect(result!['error'], contains('maxHeight'));
    expect(controller.offset, 50);
  });

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

Future<Map<String, dynamic>> _captureFullPage(WidgetTester tester,
    [Map<String, String> options = const {}]) async {
  final registry = ExtensionRegistry();
  InspectExtension.register(registry);
  ScreenshotExtension.register(registry);
  Map<String, dynamic>? result;
  await tester.runAsync(() async {
    registry.invoke('ext.fliwright.screenshot',
        {'fullPage': 'true', ...options}).then((value) {
      result = value;
    });
  });
  for (var i = 0; i < 200 && result == null; i++) {
    await tester.pump();
    await tester
        .runAsync(() => Future<void>.delayed(const Duration(milliseconds: 5)));
  }
  expect(result, isNotNull,
      reason: 'Long screenshot did not finish after pumping frames');
  return result!;
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
