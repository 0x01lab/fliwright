import 'dart:async';

import 'package:flutter/scheduler.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

/// Extension that waits for Flutter's rendering pipeline to settle.
///
/// After a click triggers a page transition or animation, the widget tree
/// may be mid-render for 300–800 ms.  Calling [settle] ensures that the
/// framework has finished all scheduled frames before the caller proceeds
/// with element lookups or assertions.
///
/// The settling logic checks [SchedulerBinding.hasScheduledFrame].  When
/// *N* consecutive frames (default 3) report no pending work, the extension
/// returns success.  A timeout (default 2 000 ms) prevents infinite waits.
class SettleExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.settle', _settle);
  }

  static Future<Map<String, dynamic>> _settle(
    Map<String, String> params,
  ) async {
    final timeoutMs = int.tryParse(params['timeout'] ?? '') ?? 2000;
    final stableThreshold =
        int.tryParse(params['stableFrames'] ?? '') ?? 3;

    final binding = WidgetsBinding.instance;
    final watch = Stopwatch()..start();

    var stableCount = 0;

    while (watch.elapsedMilliseconds < timeoutMs) {
      if (!binding.hasScheduledFrame) {
        stableCount++;
        if (stableCount >= stableThreshold) {
          return {
            'success': true,
            'settledAfterMs': watch.elapsedMilliseconds,
            'stableFrames': stableCount,
          };
        }
        // No frame scheduled — wait briefly then re-check.
        await Future<void>.delayed(const Duration(milliseconds: 16));
      } else {
        // A frame is scheduled — wait for it to complete.
        stableCount = 0;
        try {
          await binding.endOfFrame.timeout(
            const Duration(milliseconds: 200),
            onTimeout: () {},
          );
        } catch (_) {
          // endOfFrame may throw if the binding is in a bad state; just retry.
        }
      }
    }

    // Timed out but not necessarily an error — animations may still be running.
    return {
      'success': true,
      'settledAfterMs': watch.elapsedMilliseconds,
      'stableFrames': stableCount,
      'timedOut': true,
    };
  }
}
