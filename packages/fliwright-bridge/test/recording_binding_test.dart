import 'package:flutter/gestures.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/extensions/recording_binding.dart';

class _RecordingTarget implements HitTestTarget {
  _RecordingTarget(this.events);

  final List<String> events;
  bool isMounted = true;

  @override
  void handleEvent(PointerEvent event, HitTestEntry<HitTestTarget> entry) {
    isMounted = false;
    events.add('business-target');
  }
}

void main() {
  test('observes the original hit-test path before dispatch reaches targets',
      () {
    final binding = FliwrightRecordingBinding.ensureInitialized();
    final events = <String>[];
    final target = _RecordingTarget(events);
    HitTestResult? frozenResult;
    Object? frozenTarget;
    final result = HitTestResult()
      ..add(HitTestEntry<HitTestTarget>(target))
      ..add(HitTestEntry<HitTestTarget>(binding));
    void pointerRoute(PointerEvent event) {
      events.add('pointer-route');
      expect(target.isMounted, isFalse);
      expect(frozenResult?.path.first.target, same(frozenTarget));
    }

    binding.pointerRouter.addGlobalRoute(pointerRoute);
    FliwrightRecordingBinding.beforePointerDispatch = (event, hitTest) {
      events.add('before-dispatch:${hitTest?.path.length}');
      frozenResult = hitTest;
      frozenTarget = hitTest?.path.first.target;
    };

    try {
      binding.dispatchEvent(
        const PointerDownEvent(pointer: 1, position: Offset(4, 8)),
        result,
      );
    } finally {
      FliwrightRecordingBinding.beforePointerDispatch = null;
      binding.pointerRouter.removeGlobalRoute(pointerRoute);
    }

    expect(events, [
      'before-dispatch:2',
      'business-target',
      'pointer-route',
    ]);
    expect(frozenTarget, same(target));
  });

  test('initialization is idempotent for the recording binding', () {
    final binding = FliwrightRecordingBinding.ensureInitialized();
    expect(FliwrightRecordingBinding.ensureInitialized(), same(binding));
  });
}
