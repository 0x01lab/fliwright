import 'package:flutter/material.dart';

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
    final limit = int.tryParse(params['limit'] ?? '');
    var visited = 0;

    walkTreeUntil(root, (Element element) {
      if (limit != null && matchedWidgets.length >= limit) return false;
      visited++;
      if (!_matchesElement(element, parsed)) return true;
      final info = extractWidgetInfo(element);
      if (info == null) return true;
      // If ancestor selector is specified, also check ancestor match.
      if (ancestorParsed != null) {
        if (!_hasAncestor(element, ancestorParsed)) return true;
      }
      matchedWidgets.add(info);
      return limit == null || matchedWidgets.length < limit;
    });

    return {
      'widgets': matchedWidgets,
      'count': matchedWidgets.length,
      'visited': visited,
    };
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
    if (selector.startsWith('name=')) {
      return ParsedSelector(field: 'name', value: selector.substring(5));
    }
    if (selector.startsWith('ancestorKey=')) {
      return ParsedSelector(
        field: 'ancestorKey',
        value: selector.substring(12),
      );
    }
    if (selector.startsWith('semantics=')) {
      return ParsedSelector(
        field: 'semanticsLabel',
        value: selector.substring(10),
      );
    }
    if (selector.startsWith('semanticsId=')) {
      return ParsedSelector(
        field: 'semanticsId',
        value: selector.substring(12),
      );
    }
    if (selector.startsWith('role=')) {
      return ParsedSelector(field: 'role', value: selector.substring(5));
    }
    return ParsedSelector(field: 'text', value: selector);
  }

  static void walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      walkTree(child, visitor);
    });
  }

  static bool walkTreeUntil(Element root, bool Function(Element) visitor) {
    if (!visitor(root)) return false;
    var keepGoing = true;
    root.debugVisitOnstageChildren((Element child) {
      if (!keepGoing) return;
      keepGoing = walkTreeUntil(child, visitor);
    });
    return keepGoing;
  }

  static Map<String, dynamic>? extractWidgetInfo(
    Element element, {
    bool includeAncestorKey = true,
    bool includeName = true,
    bool includeSemantics = true,
  }) {
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

    widgetKey = extractKeyValue(widget.key);

    // Expensive fields: only compute when requested.
    final ancestorKey =
        includeAncestorKey ? findAncestorKey(element) : null;
    final name = includeName
        ? (extractName(widget) ?? findAncestorName(element))
        : null;
    final semantics =
        includeSemantics ? extractSemantics(element) : const ExtractedSemantics();

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
      if (ancestorKey != null) 'ancestorKey': ancestorKey,
      if (name != null) 'name': name,
      if (semantics.identifier != null) 'semanticsId': semantics.identifier,
      if (semantics.label != null) 'semanticsLabel': semantics.label,
      if (semantics.hint != null) 'semanticsHint': semantics.hint,
      if (semantics.role != null) 'role': semantics.role,
      if (rect != null) 'rect': rect,
      'properties': <String, dynamic>{},
    };
  }

  static String? extractKeyValue(Key? key) {
    if (key is ValueKey<String>) return key.value;
    if (key is ValueKey) return key.value.toString();
    return null;
  }

  static String? findAncestorKey(Element element) {
    String? result;
    element.visitAncestorElements((ancestor) {
      result = extractKeyValue(ancestor.widget.key);
      if (result != null) return false;
      if (ancestor.widget is Scaffold || ancestor.widget is WidgetsApp) {
        return false;
      }
      return true;
    });
    return result;
  }

  static String? extractName(Widget widget) {
    try {
      final value = (widget as dynamic).name;
      if (value is String && value.isNotEmpty) return value;
    } catch (_) {
      // Most widgets do not expose a name property.
    }
    return null;
  }

  static String? findAncestorName(Element element) {
    String? result;
    element.visitAncestorElements((ancestor) {
      result = extractName(ancestor.widget);
      if (result != null) return false;
      if (ancestor.widget is Scaffold || ancestor.widget is WidgetsApp) {
        return false;
      }
      return true;
    });
    return result;
  }

  static ExtractedSemantics extractSemantics(Element element) {
    ExtractedSemantics? result;

    void inspect(Element candidate) {
      if (result != null && result!.hasAnyValue) return;
      final widget = candidate.widget;
      if (widget is Semantics) {
        final properties = widget.properties;
        result = ExtractedSemantics(
          identifier: _readString(properties, 'identifier'),
          label: _readString(properties, 'label'),
          hint: _readString(properties, 'hint'),
          role: _roleFromProperties(properties),
        );
      }
    }

    inspect(element);
    if (result != null && result!.hasAnyValue) return result!;

    element.visitAncestorElements((ancestor) {
      inspect(ancestor);
      if (result != null && result!.hasAnyValue) return false;
      if (ancestor.widget is Scaffold || ancestor.widget is WidgetsApp) {
        return false;
      }
      return true;
    });

    return result ?? const ExtractedSemantics();
  }

  static String? _roleFromProperties(Object properties) {
    if (_readBool(properties, 'button') == true) return 'button';
    if (_readBool(properties, 'link') == true) return 'link';
    if (_readBool(properties, 'header') == true) return 'header';
    if (_readBool(properties, 'textField') == true) return 'textField';
    if (_readBool(properties, 'focused') == true) return 'focused';
    if (_readAny(properties, 'checked') != null) return 'checkbox';
    if (_readBool(properties, 'selected') == true) return 'selected';
    return null;
  }

  static String? _readString(Object target, String name) {
    final value = _readAny(target, name);
    return value is String ? _emptyToNull(value) : null;
  }

  static bool? _readBool(Object target, String name) {
    final value = _readAny(target, name);
    return value is bool ? value : null;
  }

  static Object? _readAny(Object target, String name) {
    try {
      final dynamic value = target;
      switch (name) {
        case 'identifier':
          return value.identifier;
        case 'label':
          return value.label;
        case 'hint':
          return value.hint;
        case 'button':
          return value.button;
        case 'link':
          return value.link;
        case 'header':
          return value.header;
        case 'textField':
          return value.textField;
        case 'focused':
          return value.focused;
        case 'checked':
          return value.checked;
        case 'selected':
          return value.selected;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  static String? _emptyToNull(String? value) {
    if (value == null || value.isEmpty) return null;
    return value;
  }

  static bool _matches(
    Map<String, dynamic> info,
    ParsedSelector selector,
  ) {
    final value = info[selector.field];
    if (value == null) return false;
    if (_requiresExactMatch(selector.field)) {
      return value.toString() == selector.value;
    }
    if (value is String) {
      return value.contains(selector.value);
    }
    return value.toString().contains(selector.value);
  }

  static bool _matchesElement(Element element, ParsedSelector selector) {
    final widget = element.widget;
    switch (selector.field) {
      case 'id':
        return '${element.hashCode}' == selector.value;
      case 'type':
        return widget.runtimeType.toString() == selector.value;
      case 'key':
        return extractKeyValue(widget.key) == selector.value;
      case 'ancestorKey':
        return findAncestorKey(element) == selector.value;
      case 'name':
        return (extractName(widget) ?? findAncestorName(element)) ==
            selector.value;
      case 'semanticsId':
        return extractSemantics(element).identifier == selector.value;
      case 'semanticsLabel':
        final label = extractSemantics(element).label;
        return label != null && label.contains(selector.value);
      case 'role':
        return extractSemantics(element).role == selector.value;
      case 'text':
        final text = extractText(widget);
        return text != null && text.contains(selector.value);
      default:
        final info = extractWidgetInfo(
          element,
          includeAncestorKey: selector.field == 'ancestorKey',
          includeName: selector.field == 'name',
          includeSemantics: selector.field == 'semanticsId' ||
              selector.field == 'semanticsLabel' ||
              selector.field == 'role',
        );
        return info != null && _matches(info, selector);
    }
  }

  static String? extractText(Widget widget) {
    if (widget is Text) return widget.data;
    if (widget is RichText) return widget.text.toPlainText();
    if (widget is EditableText) return widget.controller.text;
    return null;
  }

  static bool _requiresExactMatch(String field) {
    return field == 'id' ||
        field == 'key' ||
        field == 'ancestorKey' ||
        field == 'name' ||
        field == 'semanticsId' ||
        field == 'role' ||
        field == 'type';
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

class ExtractedSemantics {
  final String? identifier;
  final String? label;
  final String? hint;
  final String? role;

  const ExtractedSemantics({
    this.identifier,
    this.label,
    this.hint,
    this.role,
  });

  bool get hasAnyValue =>
      identifier != null || label != null || hint != null || role != null;
}

class ParsedSelector {
  final String field;
  final String value;
  ParsedSelector({required this.field, required this.value});
}
