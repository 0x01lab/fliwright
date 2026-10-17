import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  setUp(() async {
    await FliwrightBridge.reset();
    GestureExtension.register(FliwrightBridge.registry);
  });
  tearDown(FliwrightBridge.reset);

  for (final duration in ['0', '-1', 'NaN', 'Infinity', 'invalid']) {
    testWidgets('rejects invalid drag duration $duration before pointer down',
        (tester) async {
      final pointers = <PointerEvent>[];
      await tester.pumpWidget(Listener(
        behavior: HitTestBehavior.opaque,
        onPointerDown: pointers.add,
        child: const SizedBox.expand(),
      ));
      await expectLater(
        FliwrightBridge.registry.invoke('ext.fliwright.dragFrom', {
          'x': '100',
          'y': '100',
          'deltaX': '0',
          'deltaY': '-60',
          'duration': duration,
        }),
        throwsArgumentError,
      );
      expect(pointers, isEmpty);
    });
  }

  for (final coordinate in [false, true]) {
    testWidgets('preserves fractional drag timing (coordinate=$coordinate)',
        (tester) async {
      final pointers = <PointerEvent>[];
      var completed = false;
      await tester.pumpWidget(MaterialApp(
        home: Listener(
          behavior: HitTestBehavior.opaque,
          onPointerDown: pointers.add,
          onPointerMove: pointers.add,
          onPointerUp: pointers.add,
          child: const SizedBox.expand(key: Key('drag_target')),
        ),
      ));
      final result = FliwrightBridge.registry.invoke(
        coordinate ? 'ext.fliwright.dragFrom' : 'ext.fliwright.gesture',
        {
          'gesture': 'drag',
          'selector': 'key=drag_target',
          'resolvedRect':
              jsonEncode({'x': 0, 'y': 0, 'width': 200, 'height': 200}),
          'x': '100',
          'y': '100',
          'deltaX': '0',
          'deltaY': '-60',
          'steps': '2',
          'duration': '600.123',
        },
      ).then((value) {
        completed = true;
        return value;
      });
      await tester.pump();
      expect(pointers, hasLength(1));
      for (var step = 1; step <= 3; step++) {
        await tester.pump(const Duration(microseconds: 200040));
        expect(completed, false);
        expect(pointers, hasLength(step));
        await tester.pump(const Duration(microseconds: 1));
        expect(pointers, hasLength(step + 1));
      }
      expect((await result)['success'], true);
      expect(pointers.last, isA<PointerUpEvent>());
      expect(pointers.last.position, const Offset(100, 40));
      expect(pointers.last.timeStamp - pointers.first.timeStamp,
          const Duration(microseconds: 600123));
      expect(pointers[2].position, const Offset(100, 40));
    });
  }

  for (final durationMs in [600, 606.761]) {
    testWidgets('holds long press for $durationMs milliseconds before release',
        (tester) async {
      var taps = 0;
      var longPresses = 0;
      var completed = false;
      final pointers = <PointerEvent>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Listener(
            onPointerDown: pointers.add,
            onPointerUp: pointers.add,
            child: FilledButton(
              key: const Key('increment'),
              onPressed: () => taps++,
              onLongPress: () => longPresses++,
              child: const Text('Increment'),
            ),
          ),
        ),
      ));
      final rect = tester.getRect(find.byKey(const Key('increment')));
      final result = FliwrightBridge.registry.invoke('ext.fliwright.gesture', {
        'gesture': 'longPress',
        'selector': 'key=increment',
        'duration': durationMs.toString(),
        'resolvedRect': jsonEncode({
          'x': rect.left,
          'y': rect.top,
          'width': rect.width,
          'height': rect.height,
        }),
      }).then((value) {
        completed = true;
        return value;
      });

      await tester.pump();
      expect(completed, false, reason: 'The pointer must remain held');
      expect(pointers, hasLength(1));
      expect(pointers.single, isA<PointerDownEvent>());
      await tester.pump(const Duration(milliseconds: 500));
      expect(longPresses, 1);
      expect(taps, 0);
      expect(completed, false);
      final durationUs = (durationMs * 1000).round();
      await tester.pump(Duration(microseconds: durationUs - 500000 - 1));
      expect(completed, false, reason: 'Fractional milliseconds must survive');
      await tester.pump(const Duration(microseconds: 1));
      expect((await result)['success'], true);
      expect(pointers, hasLength(2));
      expect(pointers.last, isA<PointerUpEvent>());
      expect(pointers.last.timeStamp - pointers.first.timeStamp,
          Duration(microseconds: durationUs));
      expect(taps, 0);
      await tester.pumpAndSettle();
    });
  }
}
