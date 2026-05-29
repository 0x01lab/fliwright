import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

class GestureExtension {
  static int _nextPointer = 10000;

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.click', _click);
  }

  static Future<Map<String, dynamic>> _click(Map<String, String> params) async {
    final x = double.tryParse(params['x'] ?? '');
    final y = double.tryParse(params['y'] ?? '');
    if (x == null || y == null) {
      return {'error': 'Missing or invalid x, y coordinates'};
    }

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ??
        0;
    final position = Offset(x, y);
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer,
        position: position,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer,
        position: position,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + const Duration(milliseconds: 100),
      ),
    );

    return {'success': true};
  }
}
