import 'package:flutter/widgets.dart';

import '../bridge.dart';

class InspectExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.inspect', _inspect);
  }

  static Future<Map<String, dynamic>> _inspect(
      Map<String, String> params) async {
    final selector = params['selector'] ?? '';
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'error': 'No widget tree available', 'widgets': <dynamic>[]};
    }

    final parsed = _parseSelector(selector);
    final matchedWidgets = <Map<String, dynamic>>[];

    // Parse ancestor selector if provided.
    final ancestorSelectorStr = params['ancestorSelector'] ?? '';
    ParsedSelector? ancestorParsed;
    if (ancestorSelectorStr.isNotEmpty) {
      ancestorParsed = _parseSelector(ancestorSelectorStr);
    }

    walkTree(root, (Element element) {
      final info = extractWidgetInfo(element);
      if (info == null) return;
      if (_matches(info, parsed)) {
        // If ancestor selector is specified, also check ancestor match.
        if (ancestorParsed != null) {
          if (!_hasAncestor(element, ancestorParsed)) return;
        }
        matchedWidgets.add(info);
      }
    });

    return {'widgets': matchedWidgets, 'count': matchedWidgets.length};
  }

  static ParsedSelector _parseSelector(String selector) {
    if (selector.startsWith('text=')) {
      return ParsedSelector(field: 'text', value: selector.substring(5));
    }
    if (selector.startsWith('key=')) {
      return ParsedSelector(field: 'key', value: selector.substring(4));
    }
    if (selector.startsWith('byType=')) {
      return ParsedSelector(field: 'type', value: selector.substring(7));
    }
    if (selector.startsWith('id=')) {
      return ParsedSelector(field: 'id', value: selector.substring(3));
    }
    return ParsedSelector(field: 'text', value: selector);
  }

  static void walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      walkTree(child, visitor);
    });
  }

  static Map<String, dynamic>? extractWidgetInfo(Element element) {
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
    ParsedSelector selector,
  ) {
    final value = info[selector.field];
    if (value == null) return false;
    if (value is String) {
      return value.contains(selector.value);
    }
    return value.toString().contains(selector.value);
  }

  static bool _hasAncestor(Element element, ParsedSelector ancestorSelector) {
    bool found = false;
    element.visitAncestorElements((Element ancestor) {
      final info = extractWidgetInfo(ancestor);
      if (info != null && _matches(info, ancestorSelector)) {
        found = true;
        return false; // Stop visiting.
      }
      return true; // Continue visiting.
    });
    return found;
  }
}

class ParsedSelector {
  final String field;
  final String value;
  ParsedSelector({required this.field, required this.value});
}
