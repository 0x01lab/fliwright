import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/settle_extension.dart';

void main() {
  for (final cancelPendingCallback in [false, true]) {
    testWidgets(
        'pending callback gates settling (cancelled=$cancelPendingCallback)',
        (tester) async {
      final registry = ExtensionRegistry();
      SettleExtension.register(registry);
      await tester.pumpWidget(const SizedBox());
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      final callback = tester.binding.scheduleFrameCallback((_) {});
      if (cancelPendingCallback) {
        tester.binding.cancelFrameCallbackWithId(callback);
      }
      try {
        final elapsed = Stopwatch()..start();
        final result = await tester.runAsync(() => registry.invoke(
              'ext.fliwright.settle',
              {'timeout': '80'},
            ));
        expect(elapsed.elapsedMilliseconds, greaterThanOrEqualTo(30));
        expect(result!['timedOut'] == true, !cancelPendingCallback);
      } finally {
        tester.binding.cancelFrameCallbackWithId(callback);
        tester.binding
            .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();
      }
    });
  }

  for (final lifecycleState in [
    AppLifecycleState.hidden,
    AppLifecycleState.paused
  ]) {
    testWidgets('does not settle a route transition while $lifecycleState',
        (tester) async {
      final registry = ExtensionRegistry();
      SettleExtension.register(registry);
      final navigatorKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(MaterialApp(
        navigatorKey: navigatorKey,
        home: const Scaffold(body: Text('First page')),
      ));
      await tester.pumpAndSettle();

      tester.binding.handleAppLifecycleStateChanged(lifecycleState);
      try {
        navigatorKey.currentState!.push(MaterialPageRoute<void>(
          builder: (_) => const Scaffold(body: Text('Second page')),
        ));
        expect(tester.binding.hasScheduledFrame, isFalse);
        expect(tester.binding.transientCallbackCount, greaterThan(0));

        final result = await tester.runAsync(() => registry.invoke(
              'ext.fliwright.settle',
              {'timeout': '80'},
            ));
        expect(result!['timedOut'], isTrue,
            reason: 'A queued route ticker cannot advance without frames.');
        expect(find.text('Second page'), findsNothing);
      } finally {
        tester.binding
            .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
        await tester.pumpAndSettle();
      }
      expect(find.text('Second page'), findsOneWidget);
      final settled = await tester.runAsync(() => registry.invoke(
            'ext.fliwright.settle',
            {'timeout': '80'},
          ));
      expect(settled!['timedOut'], isNot(true));
    });
  }
}
