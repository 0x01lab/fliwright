import 'dart:convert';
import 'dart:math';

import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

class GestureExtension {
  static int _nextPointer = 10000;
  static ExtensionRegistry? _registry;

  static void register(ExtensionRegistry registry) {
    _registry = registry;
    registry.register('ext.fliwright.click', _click);
    registry.register('ext.fliwright.hover', _hover);
    registry.register('ext.fliwright.gesture', _gesture);
    registry.register('ext.fliwright.dragFrom', _dragFrom);
  }

  static Future<Map<String, dynamic>> _click(Map<String, String> params) async {
    final x = double.tryParse(params['x'] ?? '');
    final y = double.tryParse(params['y'] ?? '');
    if (x == null || y == null) {
      return {'error': 'Missing or invalid x, y coordinates'};
    }

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final position = Offset(x, y);
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);
    final isRightClick = params['button'] == 'right';
    final kind =
        isRightClick ? PointerDeviceKind.mouse : PointerDeviceKind.touch;
    final buttons = isRightClick ? kSecondaryMouseButton : kPrimaryButton;

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer,
        position: position,
        kind: kind,
        buttons: buttons,
        viewId: view,
        timeStamp: now,
      ),
    );

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer,
        position: position,
        kind: kind,
        buttons: buttons,
        viewId: view,
        timeStamp: now + const Duration(milliseconds: 100),
      ),
    );

    return {'success': true, if (isRightClick) 'button': 'right'};
  }

  static Future<Map<String, dynamic>> _hover(Map<String, String> params) async {
    final x = double.tryParse(params['x'] ?? '');
    final y = double.tryParse(params['y'] ?? '');
    if (x == null || y == null) {
      return {'error': 'Missing or invalid x, y coordinates'};
    }

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    GestureBinding.instance.handlePointerEvent(
      PointerHoverEvent(
        pointer: pointer,
        position: Offset(x, y),
        kind: PointerDeviceKind.mouse,
        viewId: view,
        timeStamp:
            Duration(milliseconds: DateTime.now().millisecondsSinceEpoch),
      ),
    );

    return {'success': true, 'gesture': 'hover'};
  }

  static Future<Map<String, dynamic>> _gesture(
      Map<String, String> params) async {
    final gesture = params['gesture'];
    final selector = params['selector'];

    if (gesture == null || gesture.isEmpty) {
      return {'error': 'Missing required parameter: gesture'};
    }
    if (selector == null || selector.isEmpty) {
      return {'error': 'Missing required parameter: selector'};
    }

    Map<String, dynamic>? rect;
    final resolvedRect = params['resolvedRect'];
    if (resolvedRect != null && resolvedRect.isNotEmpty) {
      rect = jsonDecode(resolvedRect) as Map<String, dynamic>;
    } else {
      // Use inspect to find the widget
      final inspectParams = <String, String>{'selector': selector};
      if (params.containsKey('ancestorSelector')) {
        inspectParams['ancestorSelector'] = params['ancestorSelector']!;
      }

      final inspectResult =
          await _registry!.invoke('ext.fliwright.inspect', inspectParams);
      final widgets = inspectResult['widgets'] as List<dynamic>?;
      if (widgets == null || widgets.isEmpty) {
        return {'error': 'No widget found matching selector: $selector'};
      }

      final widget = widgets[0] as Map<String, dynamic>;
      rect = widget['rect'] as Map<String, dynamic>?;
    }
    if (rect == null) {
      return {'error': 'Widget matching $selector has no render bounds'};
    }

    final cx =
        (rect['x'] as num).toDouble() + (rect['width'] as num).toDouble() / 2;
    final cy =
        (rect['y'] as num).toDouble() + (rect['height'] as num).toDouble() / 2;

    switch (gesture) {
      case 'longPress':
        return _longPress(cx, cy, params);
      case 'drag':
        return _drag(cx, cy, params);
      case 'semanticDrag':
        return _semanticDrag(cx, cy, rect, params);
      case 'slideTo':
        return _slideTo(cx, cy, rect, params);
      case 'pinch':
        return _pinch(cx, cy, rect, params);
      default:
        return {'error': 'Unknown gesture type: $gesture'};
    }
  }

  static Future<Map<String, dynamic>> _longPress(
      double x, double y, Map<String, String> params) async {
    final duration = int.tryParse(params['duration'] ?? '') ?? 500;

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
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
        timeStamp: now + Duration(milliseconds: duration),
      ),
    );

    return {'success': true, 'gesture': 'longPress'};
  }

  static Future<Map<String, dynamic>> _drag(
      double x, double y, Map<String, String> params) async {
    final deltaX = double.tryParse(params['deltaX'] ?? '');
    final deltaY = double.tryParse(params['deltaY'] ?? '');
    if (deltaX == null || deltaY == null) {
      return {'error': 'Missing required parameters: deltaX, deltaY'};
    }

    final steps = int.tryParse(params['steps'] ?? '') ?? 10;

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer,
        position: Offset(x, y),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );

    for (var i = 1; i <= steps; i++) {
      final t = i / steps;
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(
          pointer: pointer,
          position: Offset(x + deltaX * t, y + deltaY * t),
          kind: PointerDeviceKind.touch,
          viewId: view,
          timeStamp: now + Duration(milliseconds: (i * 16)),
        ),
      );
    }

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer,
        position: Offset(x + deltaX, y + deltaY),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + Duration(milliseconds: (steps * 16) + 16),
      ),
    );

    return {'success': true, 'gesture': 'drag'};
  }

  /// Drag from the widget center in a semantic direction by a given distance.
  ///
  /// Params:
  ///   direction – 'left' | 'right' | 'up' | 'down' (default: 'right')
  ///   distance  – logical pixels to drag (default: 50% of widget width/height)
  ///   steps     – interpolation steps (default: 20)
  static Future<Map<String, dynamic>> _semanticDrag(
    double cx,
    double cy,
    Map<String, dynamic> rect,
    Map<String, String> params,
  ) async {
    final direction = params['direction'] ?? 'right';
    final defaultDist = direction == 'left' || direction == 'right'
        ? (rect['width'] as num).toDouble() * 0.5
        : (rect['height'] as num).toDouble() * 0.5;
    final distance =
        double.tryParse(params['distance'] ?? '') ?? defaultDist;
    final steps = int.tryParse(params['steps'] ?? '') ?? 20;

    double deltaX = 0, deltaY = 0;
    switch (direction) {
      case 'left':
        deltaX = -distance;
      case 'right':
        deltaX = distance;
      case 'up':
        deltaY = -distance;
      case 'down':
        deltaY = distance;
    }

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer,
        position: Offset(cx, cy),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );

    for (var i = 1; i <= steps; i++) {
      final t = i / steps;
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(
          pointer: pointer,
          position: Offset(cx + deltaX * t, cy + deltaY * t),
          kind: PointerDeviceKind.touch,
          viewId: view,
          timeStamp: now + Duration(milliseconds: (i * 16)),
        ),
      );
    }

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer,
        position: Offset(cx + deltaX, cy + deltaY),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + Duration(milliseconds: (steps * 16) + 16),
      ),
    );

    return {
      'success': true,
      'gesture': 'semanticDrag',
      'direction': direction,
      'distance': distance,
    };
  }

  /// Slide a widget (e.g. slider knob) to a target X position.
  ///
  /// Params:
  ///   targetX – absolute logical X coordinate to slide to
  ///   steps   – interpolation steps (default: 25, smoother for sliders)
  static Future<Map<String, dynamic>> _slideTo(
    double cx,
    double cy,
    Map<String, dynamic> rect,
    Map<String, String> params,
  ) async {
    final targetX = double.tryParse(params['targetX'] ?? '');
    if (targetX == null) {
      return {'error': 'Missing required parameter: targetX'};
    }
    final deltaX = targetX - cx;
    final steps = int.tryParse(params['steps'] ?? '') ?? 25;

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer,
        position: Offset(cx, cy),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );

    for (var i = 1; i <= steps; i++) {
      final t = i / steps;
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(
          pointer: pointer,
          position: Offset(cx + deltaX * t, cy),
          kind: PointerDeviceKind.touch,
          viewId: view,
          timeStamp: now + Duration(milliseconds: (i * 16)),
        ),
      );
    }

    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer,
        position: Offset(targetX, cy),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + Duration(milliseconds: (steps * 16) + 16),
      ),
    );

    return {
      'success': true,
      'gesture': 'slideTo',
      'fromX': cx,
      'toX': targetX,
    };
  }

  static Future<Map<String, dynamic>> _pinch(double cx, double cy,
      Map<String, dynamic> rect, Map<String, String> params) async {
    final scale = double.tryParse(params['scale'] ?? '') ?? 0.5;
    final steps = int.tryParse(params['steps'] ?? '') ?? 10;

    final halfWidth = (rect['width'] as num).toDouble() / 2;
    final halfHeight = (rect['height'] as num).toDouble() / 2;
    final radius = min(halfWidth, halfHeight) * 0.4;

    // Two fingers start at opposite ends and move toward/away from center
    final startOffset = radius;
    final endOffset = radius * scale;

    final pointer1 = _nextPointer++;
    final pointer2 = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    // Finger 1 starts to the left, Finger 2 to the right
    final p1Start = Offset(cx - startOffset, cy);
    final p1End = Offset(cx - endOffset, cy);
    final p2Start = Offset(cx + startOffset, cy);
    final p2End = Offset(cx + endOffset, cy);

    // Both fingers down
    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer1,
        position: p1Start,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );
    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer2,
        position: p2Start,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );

    // Interpolated moves
    for (var i = 1; i <= steps; i++) {
      final t = i / steps;
      final p1Pos = Offset(
        p1Start.dx + (p1End.dx - p1Start.dx) * t,
        cy,
      );
      final p2Pos = Offset(
        p2Start.dx + (p2End.dx - p2Start.dx) * t,
        cy,
      );
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(
          pointer: pointer1,
          position: p1Pos,
          kind: PointerDeviceKind.touch,
          viewId: view,
          timeStamp: now + Duration(milliseconds: (i * 16)),
        ),
      );
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(
          pointer: pointer2,
          position: p2Pos,
          kind: PointerDeviceKind.touch,
          viewId: view,
          timeStamp: now + Duration(milliseconds: (i * 16)),
        ),
      );
    }

    // Both fingers up
    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer1,
        position: p1End,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + Duration(milliseconds: (steps * 16) + 16),
      ),
    );
    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer2,
        position: p2End,
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + Duration(milliseconds: (steps * 16) + 16),
      ),
    );

    return {'success': true, 'gesture': 'pinch'};
  }

  /// Drag from an arbitrary (x, y) coordinate without needing a Flutter widget.
  /// Used for WebView overlays (e.g. captcha sliders) that are not in the
  /// Flutter widget tree.
  static Future<Map<String, dynamic>> _dragFrom(
      Map<String, String> params) async {
    final x = double.tryParse(params['x'] ?? '');
    final y = double.tryParse(params['y'] ?? '');
    final deltaX = double.tryParse(params['deltaX'] ?? '');
    final deltaY = double.tryParse(params['deltaY'] ?? '');

    if (x == null || y == null || deltaX == null || deltaY == null) {
      return {'error': 'Missing required parameters: x, y, deltaX, deltaY'};
    }

    final steps = int.tryParse(params['steps'] ?? '') ?? 20;

    final pointer = _nextPointer++;
    final view =
        WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0;
    final now = Duration(milliseconds: DateTime.now().millisecondsSinceEpoch);

    // Pointer down at start position
    GestureBinding.instance.handlePointerEvent(
      PointerDownEvent(
        pointer: pointer,
        position: Offset(x, y),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now,
      ),
    );

    // Interpolated move events
    for (var i = 1; i <= steps; i++) {
      final t = i / steps;
      GestureBinding.instance.handlePointerEvent(
        PointerMoveEvent(
          pointer: pointer,
          position: Offset(x + deltaX * t, y + deltaY * t),
          kind: PointerDeviceKind.touch,
          viewId: view,
          timeStamp: now + Duration(milliseconds: (i * 16)),
        ),
      );
    }

    // Pointer up at end position
    GestureBinding.instance.handlePointerEvent(
      PointerUpEvent(
        pointer: pointer,
        position: Offset(x + deltaX, y + deltaY),
        kind: PointerDeviceKind.touch,
        viewId: view,
        timeStamp: now + Duration(milliseconds: (steps * 16) + 16),
      ),
    );

    return {'success': true, 'gesture': 'dragFrom'};
  }
}
