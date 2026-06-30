import 'package:flutter/material.dart';

import '../bridge.dart';

const _interactiveTypes = {
  'ElevatedButton',
  'TextButton',
  'OutlinedButton',
  'IconButton',
  'FloatingActionButton',
  'TextField',
  'TextFormField',
  'Checkbox',
  'Switch',
  'Radio',
  'Slider',
  'DropdownButton',
  'PopupMenuButton',
  'ListTile',
  'InkWell',
  'GestureDetector',
  'DropdownButtonFormField',
};

class SnapshotExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.snapshot', _snapshot);
  }

  static Future<Map<String, dynamic>> _snapshot(
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'widgets': <dynamic>[], 'error': 'No widget tree available'};
    }

    final widgets = <Map<String, dynamic>>[];
    _walkTree(root, null, (Element element, Element? parent) {
      final widget = element.widget;
      final typeName = widget.runtimeType.toString();
      if (!_interactiveTypes.contains(typeName)) return;

      final renderObject = element.findRenderObject();
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
      if (rect == null) return;

      final text = _extractText(element);
      final key = _extractKey(widget);
      final parentType =
          parent != null ? parent.widget.runtimeType.toString() : null;
      final parentText = parent != null ? _extractText(parent) : null;
      final adjacentText = _extractAdjacentTexts(element);
      final callbackNames = _extractCallbackNames(widget);
      final properties = _extractProperties(widget);

      final descBuffer = StringBuffer()..write(typeName);
      if (text != null)
        descBuffer
          ..write(" with text '")
          ..write(text)
          ..write("'");
      descBuffer
        ..write(', parent ')
        ..write(parentType ?? 'null');
      if (adjacentText.isNotEmpty) {
        descBuffer
          ..write(', adjacent [')
          ..write(adjacentText.join(', '))
          ..write(']');
      }

      widgets.add({
        'id': '${element.hashCode}',
        'type': typeName,
        if (text != null) 'text': text,
        if (key != null) 'key': key,
        'rect': rect,
        if (parentType != null) 'parentType': parentType,
        if (parentText != null) 'parentText': parentText,
        'adjacentText': adjacentText,
        'callbackNames': callbackNames,
        'properties': properties,
        'description': descBuffer.toString(),
      });
    });

    return {'widgets': widgets, 'count': widgets.length};
  }

  static void _walkTree(
    Element root,
    Element? parent,
    void Function(Element, Element?) visitor,
  ) {
    visitor(root, parent);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, root, visitor);
    });
  }

  static String? _extractText(Element element) {
    final widget = element.widget;
    if (widget is Text) return widget.data;
    if (widget is RichText) return widget.text.toPlainText();
    if (widget is EditableText) return widget.controller.text;
    return null;
  }

  static String? _extractKey(Widget widget) {
    final key = widget.key;
    if (key is ValueKey<String>) return key.value;
    if (key is ValueKey) return key.value.toString();
    return null;
  }

  static List<String> _extractAdjacentTexts(Element element) {
    final texts = <String>[];
    element.visitChildElements((Element child) {
      final text = _extractText(child);
      if (text != null && text.isNotEmpty) texts.add(text);
    });
    element.visitAncestorElements((Element ancestor) {
      ancestor.visitChildElements((Element sibling) {
        if (sibling.hashCode != element.hashCode) {
          final text = _extractText(sibling);
          if (text != null && text.isNotEmpty) texts.add(text);
        }
      });
      return false;
    });
    return texts;
  }

  static List<String> _extractCallbackNames(Widget widget) {
    final names = <String>[];
    final str = widget.toStringShort();
    final regex = RegExp(r'(\w+)\s*:');
    for (final match in regex.allMatches(str)) {
      final name = match.group(1);
      if (name != null &&
          (name.startsWith('on') ||
              name == 'onPressed' ||
              name == 'onChanged')) {
        names.add(name);
      }
    }
    return names;
  }

  static Map<String, dynamic> _extractProperties(Widget widget) {
    final props = <String, dynamic>{};
    if (widget is TextField) {
      props['enabled'] = widget.enabled;
    }
    if (widget is Checkbox) {
      props['enabled'] = widget.onChanged != null;
      props['checked'] = widget.value;
    }
    if (widget is Switch) {
      props['enabled'] = widget.onChanged != null;
      props['checked'] = widget.value;
    }
    if (widget is Radio) {
      final dynamic radio = widget;
      props['checked'] = radio.value == radio.groupValue;
    }
    return props;
  }
}
