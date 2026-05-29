import 'package:flutter/widgets.dart';

import '../bridge.dart';

class InspectExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.inspect', _inspect);
  }

  static Future<Map<String, dynamic>> _inspect(Map<String, String> params) async {
    final selector = params['selector'] ?? '';
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'error': 'No widget tree available', 'widgets': <dynamic>[]};
    }

    final parsed = _parseSelector(selector);
    final matchedWidgets = <Map<String, dynamic>>[];

    _walkTree(root, (Element element) {
      final info = _extractWidgetInfo(element);
      if (info == null) return;
      if (_matches(info, parsed)) {
        matchedWidgets.add(info);
      }
    });

    return {'widgets': matchedWidgets, 'count': matchedWidgets.length};
  }

  static _ParsedSelector _parseSelector(String selector) {
    if (selector.startsWith('text=')) {
      return _ParsedSelector(field: 'text', value: selector.substring(5));
    }
    if (selector.startsWith('key=')) {
      return _ParsedSelector(field: 'key', value: selector.substring(4));
    }
    if (selector.startsWith('byType=')) {
      return _ParsedSelector(field: 'type', value: selector.substring(7));
    }
    return _ParsedSelector(field: 'text', value: selector);
  }

  static void _walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, visitor);
    });
  }

  static Map<String, dynamic>? _extractWidgetInfo(Element element) {
    final widget = element.widget;
    final renderObject = element.findRenderObject();

    String? text;
    String? widgetKey;

    if (widget is Text) {
      text = widget.data;
    } else if (widget is RichText) {
      text = widget.text.toPlainText();
    } else if (widget is EditableText) {
      text = widget.controller.text;
    }

    final key = widget.key;
    if (key is ValueKey<String>) {
      widgetKey = key.value;
    } else if (key is ValueKey) {
      widgetKey = key.value.toString();
    }

    Map<String, dynamic>? rect;
    if (renderObject is RenderBox && renderObject.hasSize) {
      final topLeft = renderObject.localToGlobal(Offset.zero);
      final size = renderObject.size;
      rect = {
        'x': topLeft.dx,
        'y': topLeft.dy,
        'width': size.width,
        'height': size.height,
      };
    }

    return {
      'id': '${element.hashCode}',
      'type': widget.runtimeType.toString(),
      if (text != null) 'text': text,
      if (widgetKey != null) 'key': widgetKey,
      if (rect != null) 'rect': rect,
      'properties': <String, dynamic>{},
    };
  }

  static bool _matches(
    Map<String, dynamic> info,
    _ParsedSelector selector,
  ) {
    final value = info[selector.field];
    if (value == null) return false;
    if (value is String) {
      return value.contains(selector.value);
    }
    return value.toString().contains(selector.value);
  }
}

class _ParsedSelector {
  final String field;
  final String value;
  _ParsedSelector({required this.field, required this.value});
}
