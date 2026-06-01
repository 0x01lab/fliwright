import 'package:flutter/material.dart';

import 'inspect.dart';
import '../bridge.dart';

class FormExtractExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.extractForm', _extractForm);
  }

  static Future<Map<String, dynamic>> _extractForm(
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'fields': <dynamic>[], 'count': 0};
    }

    final scope = params['scope'];
    final fields = <Map<String, dynamic>>[];
    final seenEditableKeys = <String>{};

    InspectExtension.walkTree(root, (Element element) {
      // Scope filtering: only extract fields inside the specified widget type.
      // e.g. scope='RegisterPage' only extracts fields under a RegisterPage widget.
      if (scope != null && scope.isNotEmpty) {
        bool inScope = false;
        element.visitAncestorElements((ancestor) {
          if (ancestor.widget.runtimeType.toString() == scope) {
            inScope = true;
            return false;
          }
          // Stop at logical boundaries to avoid matching across pages.
          if (ancestor.widget is Scaffold) return false;
          return true;
        });
        if (!inScope) return;
      }
      final widget = element.widget;

      // Extract from Material TextField widgets.
      // This also catches TextFields rendered inside TextFormField,
      // since TextFormField builds a TextField as its child.
      if (widget is TextField) {
        // Determine if this TextField lives inside a TextFormField.
        final formFieldType = _getFormFieldType(element);

        _addTextField(
          element: element,
          decoration: widget.decoration,
          keyboardType: widget.keyboardType,
          maxLength: widget.maxLength,
          obscureText: widget.obscureText,
          enabled: widget.enabled,
          overrideType: formFieldType,
          fields: fields,
        );
        // Track underlying EditableText so we don't duplicate.
        _markEditableSeen(element, seenEditableKeys);
        return;
      }

      // Catch raw EditableText not already covered by a TextField parent.
      if (widget is EditableText) {
        final hashId = '${element.hashCode}';
        if (seenEditableKeys.contains(hashId)) return;

        final info = InspectExtension.extractWidgetInfo(element);
        if (info == null) return;

        final keyboardType = _keyboardTypeName(widget.keyboardType);

        String selector;
        final key = info['key'];
        if (key != null) {
          selector = 'key=$key';
        } else {
          selector = 'byType=${info['type']}';
        }

        fields.add({
          'id': info['id'],
          'type': info['type'],
          if (info['rect'] != null) 'rect': info['rect'],
          if (keyboardType != null) 'keyboardType': keyboardType,
          'obscureText': widget.obscureText,
          'selector': selector,
        });
      }
    });

    return {'fields': fields, 'count': fields.length};
  }

  /// Check whether this element has a TextFormField ancestor, and if so
  /// return 'TextFormField' so we can report the correct wrapper type.
  static String? _getFormFieldType(Element element) {
    String? result;
    element.visitAncestorElements((ancestor) {
      if (ancestor.widget is TextFormField) {
        result = 'TextFormField';
        return false;
      }
      // Stop at reasonable boundaries -- don't climb beyond the page.
      if (ancestor.widget is Scaffold || ancestor.widget is MaterialApp) {
        return false;
      }
      return true;
    });
    return result;
  }

  /// Extract metadata from a TextField widget.
  static void _addTextField({
    required Element element,
    required InputDecoration? decoration,
    required TextInputType keyboardType,
    required int? maxLength,
    required bool obscureText,
    required bool? enabled,
    required String? overrideType,
    required List<Map<String, dynamic>> fields,
  }) {
    final info = InspectExtension.extractWidgetInfo(element);
    if (info == null) return;

    final hintText = decoration?.hintText;
    final label = decoration?.labelText;
    final kbType = _keyboardTypeName(keyboardType);
    final effectiveMaxLength =
        (maxLength != null && maxLength > 0) ? maxLength : null;

    String selector;
    if (hintText != null && hintText.isNotEmpty) {
      selector = 'text=$hintText';
    } else {
      final key = info['key'];
      if (key != null) {
        selector = 'key=$key';
      } else {
        selector = 'byType=${overrideType ?? info['type']}';
      }
    }

    fields.add({
      'id': info['id'],
      'type': overrideType ?? info['type'],
      if (info['rect'] != null) 'rect': info['rect'],
      if (hintText != null) 'hintText': hintText,
      if (label != null) 'label': label,
      if (kbType != null) 'keyboardType': kbType,
      if (effectiveMaxLength != null) 'maxLength': effectiveMaxLength,
      'obscureText': obscureText,
      'enabled': enabled ?? true,
      'selector': selector,
    });
  }

  /// Walk descendants of a TextField to find the inner EditableText
  /// and mark its element hash so we skip it during tree traversal.
  static void _markEditableSeen(
    Element parent,
    Set<String> seenEditableKeys,
  ) {
    void visitor(Element element) {
      if (element.widget is EditableText) {
        seenEditableKeys.add('${element.hashCode}');
      }
      element.visitChildren(visitor);
    }

    parent.visitChildren(visitor);
  }

  static String? _keyboardTypeName(TextInputType inputType) {
    if (inputType == TextInputType.phone) return 'phone';
    if (inputType == TextInputType.emailAddress) return 'emailAddress';
    if (inputType == TextInputType.number) return 'number';
    if (inputType == TextInputType.url) return 'url';
    if (inputType == TextInputType.multiline) return 'multiline';
    if (inputType == TextInputType.visiblePassword) return 'visiblePassword';
    if (inputType == TextInputType.text) return 'text';
    if (inputType == TextInputType.datetime) return 'datetime';
    if (inputType == TextInputType.name) return 'name';
    if (inputType == TextInputType.streetAddress) return 'streetAddress';
    if (inputType == TextInputType.none) return 'none';
    // Fallback: use index.
    return 'textInput_${inputType.index}';
  }
}
