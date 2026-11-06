import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';
import 'package:fliwright_bridge/src/extensions/type_extension.dart';

void main() {
  setUp(() {
    FliwrightBridge.registry.reset();
    RefRegistry.resetForTesting();
    InspectExtension.register(FliwrightBridge.registry);
    GestureExtension.register(FliwrightBridge.registry);
  });
  testWidgets('covered ref refuses to dispatch a tap through an overlay',
      (tester) async {
    var targetTaps = 0;
    var overlayTaps = 0;
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: Stack(children: [
          Positioned(
              left: 0,
              top: 0,
              width: 100,
              height: 100,
              child: GestureDetector(
                  key: const ValueKey('target'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    targetTaps++;
                  },
                  child: const SizedBox.expand())),
          Positioned(
              left: 0,
              top: 0,
              width: 100,
              height: 100,
              child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    overlayTaps++;
                  },
                  child: const ColoredBox(color: Colors.red))),
        ])));
    final el = tester.element(find.byKey(const ValueKey('target')));
    final ref = RefRegistry.registerEntry(
        rect: tester.getRect(find.byKey(const ValueKey('target'))),
        element: el,
        groupId: 'review',
        isTextField: false,
        enabled: true);
    final selectorResult =
        await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'tap',
      'selector': jsonEncode({
        'match': {'key': 'target'}
      })
    });
    final refResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.action',
        {'action': 'tap', 'ref': ref, 'checkStable': 'false'});
    await tester.pump();
    expect(selectorResult['success'], false);
    expect(refResult['success'], false);
    expect(targetTaps, 0);
    expect(overlayTaps, 0);
  });

  testWidgets('ref fill uses the current rect after the field moves',
      (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    TypeExtension.register(FliwrightBridge.registry);
    Widget fixture(double top) => MaterialApp(
            home: Scaffold(
                body: Stack(children: [
          Positioned(
              left: 0,
              top: top,
              width: 240,
              height: 60,
              child:
                  TextField(key: const Key('email'), controller: controller)),
        ])));
    await tester.pumpWidget(fixture(0));
    final finder = find.byKey(const Key('email'));
    final ref = RefRegistry.registerEntry(
        rect: tester.getRect(finder),
        element: tester.element(finder),
        groupId: 'test',
        isTextField: true,
        enabled: true);
    await tester.pumpWidget(fixture(120));
    final clicks = <Map<String, String>>[];
    // Capture the physical focus point while retaining real TypeExtension behavior.
    FliwrightBridge.registry.reset();
    InspectExtension.register(FliwrightBridge.registry);
    TypeExtension.register(FliwrightBridge.registry);
    FliwrightBridge.registry.register('ext.fliwright.click', (params) async {
      clicks.add(params);
      return {'success': true};
    });
    final future = FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'fill',
      'ref': ref,
      'text': 'alice@example.com',
      'checkStable': 'false',
    });
    await tester.pump(const Duration(milliseconds: 100));
    final result = await future;
    expect(result['success'], true);
    expect(controller.text, 'alice@example.com');
    expect(double.parse(clicks.single['y']!), tester.getRect(finder).center.dy);
  });

  testWidgets('actions honor timeout while waiting for a target to appear',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(const SizedBox.shrink());
    final future = FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'tap',
      'selector': jsonEncode({
        'match': {'key': 'late'}
      }),
      'timeout': '500',
      'checkStable': 'false',
    });
    await tester.pump(const Duration(milliseconds: 30));
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: GestureDetector(
            key: const Key('late'),
            behavior: HitTestBehavior.opaque,
            onTap: () {
              taps++;
            },
            child: const SizedBox(width: 100, height: 40))));
    await tester.pump(const Duration(milliseconds: 30));
    final result = await future;
    expect(result['success'], true);
    expect(taps, 1);
  });

  testWidgets(
      'stale precomputed identity never falls back to another matching widget',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: GestureDetector(
            key: const Key('replacement'),
            behavior: HitTestBehavior.opaque,
            onTap: () {
              taps++;
            },
            child: const SizedBox(width: 100, height: 40))));
    final result =
        await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'tap',
      'selector': jsonEncode({
        'match': {'key': 'replacement'}
      }),
      'targetId': 'removed-target',
      'targetRect': '{"x":0,"y":0,"width":100,"height":40}',
    });
    expect(result['success'], false);
    expect(taps, 0);
  });

  testWidgets('precomputed action follows the live target after layout changes',
      (tester) async {
    var targetTaps = 0;
    var decoyTaps = 0;
    Widget fixture(bool moved) => Directionality(
        textDirection: TextDirection.ltr,
        child: Stack(children: [
          Positioned(
              left: 0,
              top: moved ? 120 : 0,
              width: 100,
              height: 100,
              child: GestureDetector(
                  key: const ValueKey('target'),
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    targetTaps++;
                  },
                  child: const SizedBox.expand())),
          if (moved)
            Positioned(
                left: 0,
                top: 0,
                width: 100,
                height: 100,
                child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () {
                      decoyTaps++;
                    },
                    child: const ColoredBox(color: Colors.red))),
        ]));
    await tester.pumpWidget(fixture(false));
    final selector = jsonEncode({
      'match': {'key': 'target'}
    });
    final resolved = await FliwrightBridge.registry
        .invoke('ext.fliwright.resolve', {'selector': selector});
    final old = (resolved['matches'] as List).single as Map;
    await tester.pumpWidget(fixture(true));
    final result =
        await FliwrightBridge.registry.invoke('ext.fliwright.action', {
      'action': 'tap',
      'selector': selector,
      'targetId': '${old['id']}',
      'targetRect': jsonEncode(old['rect'])
    });
    await tester.pump();
    expect(result['success'], true);
    expect(targetTaps, 1);
    expect(decoyTaps, 0);
  });
}
