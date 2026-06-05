import 'dart:developer';
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/widgets.dart';
import '../bridge.dart';
import 'inspect.dart';

class RecordingExtension {
  static bool _recording = false;
  static PointerRoute? _pointerRoute;
  static Timer? _textPollingTimer;
  static final Map<int, String> _lastTextByElement = <int, String>{};

  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.startRecording', _startRecording);
    registry.register('ext.fliwright.stopRecording', _stopRecording);
    registry.register('ext.fliwright.hitTest', _hitTest);
  }

  static Future<Map<String, dynamic>> _startRecording(
      Map<String, String> params) async {
    debugPrint('[fliwright] startRecording called, _recording=$_recording');
    if (_recording) return {'recording': true};
    _recording = true;
    _lastTextByElement.clear();
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
      debugPrint('[fliwright] pointerEvent: kind=$kind ptr=${event.pointer} pos=(${event.position.dx.toStringAsFixed(1)}, ${event.position.dy.toStringAsFixed(1)})');
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
    debugPrint('[fliwright] pointer route added, recording started');
    _textPollingTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      _pollFocusedTextInput();
    });
    return {'recording': true};
  }

  static Future<Map<String, dynamic>> _stopRecording(
      Map<String, String> params) async {
    debugPrint('[fliwright] stopRecording called, _recording=$_recording');
    _textPollingTimer?.cancel();
    _textPollingTimer = null;
    if (_pointerRoute != null) {
      GestureBinding.instance.pointerRouter.removeGlobalRoute(_pointerRoute!);
      _pointerRoute = null;
    }
    _recording = false;
    _lastTextByElement.clear();
    return {'recording': false};
  }

  static Future<void> reset() async {
    await _stopRecording(<String, String>{});
  }

  static Future<Map<String, dynamic>> _hitTest(
      Map<String, String> params) async {
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
        final rect =
            Rect.fromLTWH(topLeft.dx, topLeft.dy, size.width, size.height);
        if (rect.contains(Offset(x, y))) {
          final widget = element.widget;
          // Skip pure text/render widgets, prefer interactive ones.
          if (widget is! RichText &&
              widget is! Text &&
              widget is! Semantics &&
              widget is! RepaintBoundary) {
            best = element;
          }
        }
      }
    });

    if (best == null) return {'widget': <String, dynamic>{}};
    final info = InspectExtension.extractWidgetInfo(best!);
    return {'widget': info};
  }

  static void _pollFocusedTextInput() {
    if (!_recording) return;

    final editable = _findFocusedEditableText();
    if (editable == null) return;

    final widget = editable.widget;
    if (widget is! EditableText) return;

    final id = widget.controller.hashCode;
    final text = widget.controller.text;
    final previous = _lastTextByElement[id];
    if (previous == null) {
      _lastTextByElement[id] = text;
      return;
    }
    if (text == previous) return;

    final isReplacement = !text.startsWith(previous);
    final recordedText = isReplacement ? text : text.substring(previous.length);
    _lastTextByElement[id] = text;
    if (recordedText.isEmpty) return;

    final event = <String, dynamic>{
      'type': 'textInput',
      'text': recordedText,
      'timestamp': DateTime.now().microsecondsSinceEpoch,
    };
    if (isReplacement) event['action'] = 'replace';
    postEvent('FliwrightRecording', event);
  }

  static Element? _findFocusedEditableText() {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return null;

    Element? focused;
    InspectExtension.walkTree(root, (Element element) {
      final widget = element.widget;
      if (widget is EditableText && widget.focusNode.hasFocus) {
        focused = element;
      }
    });
    return focused;
  }
}
