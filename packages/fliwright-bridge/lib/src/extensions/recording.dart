import 'dart:developer';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/widgets.dart';
import '../bridge.dart';
import 'inspect.dart';

class RecordingExtension {
  static bool _recording = false;
  static PointerRoute? _pointerRoute;

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.startRecording', _startRecording);
    registry.register('ext.fliwright.stopRecording', _stopRecording);
    registry.register('ext.fliwright.hitTest', _hitTest);
  }

  static Future<Map<String, dynamic>> _startRecording(Map<String, String> params) async {
    if (_recording) return {'recording': true};
    _recording = true;
    _pointerRoute = (PointerEvent event) {
      if (!_recording) return;
      String kind;
      if (event is PointerDownEvent) {
        kind = 'down';
      } else if (event is PointerMoveEvent) {
        kind = 'move';
      } else if (event is PointerUpEvent) {
        kind = 'up';
      } else {
        return;
      }
      postEvent('FliwrightRecording', {
        'type': 'pointerEvent',
        'kind': kind,
        'pointer': event.pointer,
        'position': {'x': event.position.dx, 'y': event.position.dy},
        'timestamp': event.timeStamp.inMicroseconds,
        'buttons': event.buttons,
      });
    };
    GestureBinding.instance.pointerRouter.addGlobalRoute(_pointerRoute!);
    return {'recording': true};
  }

  static Future<Map<String, dynamic>> _stopRecording(Map<String, String> params) async {
    if (_pointerRoute != null) {
      GestureBinding.instance.pointerRouter.removeGlobalRoute(_pointerRoute!);
      _pointerRoute = null;
    }
    _recording = false;
    return {'recording': false};
  }

  static Future<Map<String, dynamic>> _hitTest(Map<String, String> params) async {
    final x = double.tryParse(params['x'] ?? '') ?? 0.0;
    final y = double.tryParse(params['y'] ?? '') ?? 0.0;
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return {'widget': <String, dynamic>{}};

    // Find the most specific element at (x,y) that isn't a basic text/render widget.
    Element? best;
    InspectExtension.walkTree(root, (Element element) {
      final renderObject = element.findRenderObject();
      if (renderObject is RenderBox && renderObject.hasSize) {
        final topLeft = renderObject.localToGlobal(Offset.zero);
        final size = renderObject.size;
        final rect = Rect.fromLTWH(topLeft.dx, topLeft.dy, size.width, size.height);
        if (rect.contains(Offset(x, y))) {
          final widget = element.widget;
          // Skip pure text/render widgets, prefer interactive ones.
          if (widget is! RichText && widget is! Text && widget is! Semantics && widget is! RepaintBoundary) {
            best = element;
          }
        }
      }
    });

    if (best == null) return {'widget': <String, dynamic>{}};
    final info = InspectExtension.extractWidgetInfo(best!);
    return {'widget': info};
  }
}
