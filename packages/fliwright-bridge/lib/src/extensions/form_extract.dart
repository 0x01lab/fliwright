import 'dart:convert';

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
    final seenNamedFields = <String>{};

    // Use depth-tracking walk for O(N) scope filtering instead of
    // per-element O(depth) ancestor walks.
    _walkTreeInScope(root, scope, (Element element) {
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
        _markNamedFieldSeen(element, seenNamedFields);
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

        final selector = _selectorFor(
          info,
          fallbackType: info['type']?.toString(),
        );

        fields.add({
          'id': info['id'],
          'type': info['type'],
          'controlType': 'textInput',
          if (info['rect'] != null) 'rect': info['rect'],
          ..._stableMetadata(info),
          if (keyboardType != null) 'keyboardType': keyboardType,
          'obscureText': widget.obscureText,
          'enabled': true,
          'selector': selector,
        });
        _markNamedFieldSeen(element, seenNamedFields);
        return;
      }

      final name = _readString(widget, 'name');
      if (name != null) {
        if (seenNamedFields.contains(name)) return;
        if (_hasEditableDescendant(element)) return;

        final field = _extractNamedField(element, name);
        if (field != null) {
          fields.add(field);
          seenNamedFields.add(name);
        }
      }
    });

    return {'fields': fields, 'count': fields.length};
  }

  /// Walk the widget tree, only visiting elements inside [scope].
  /// Uses an integer depth counter instead of per-element ancestor walks,
  /// reducing scope checking from O(depth × N) to O(N).
  static void _walkTreeInScope(
    Element root,
    String? scope,
    void Function(Element element) visitor,
  ) {
    if (scope == null || scope.isEmpty) {
      // No scope — visit everything.
      InspectExtension.walkTree(root, visitor);
      return;
    }

    int scopeDepth = 0;

    void walk(Element element) {
      final typeName = element.widget.runtimeType.toString();

      if (typeName == scope) {
        scopeDepth++;
      }

      // Only invoke visitor when inside the scope.
      if (scopeDepth > 0) {
        visitor(element);
      }

      // Recurse into children when inside scope or still searching for it.
      element.debugVisitOnstageChildren((child) {
        walk(child);
      });

      if (typeName == scope) {
        scopeDepth--;
      }
    }

    walk(root);
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

    final selector = _selectorFor(
      info,
      hintText: hintText,
      label: label,
      fallbackType: overrideType ?? info['type']?.toString(),
    );

    fields.add({
      'id': info['id'],
      'type': overrideType ?? info['type'],
      'controlType': 'textInput',
      if (info['rect'] != null) 'rect': info['rect'],
      ..._stableMetadata(info),
      if (hintText != null) 'hintText': hintText,
      if (label != null) 'label': label,
      if (kbType != null) 'keyboardType': kbType,
      if (effectiveMaxLength != null) 'maxLength': effectiveMaxLength,
      'obscureText': obscureText,
      'enabled': enabled ?? true,
      'selector': selector,
    });
  }

  static Map<String, dynamic> _stableMetadata(Map<String, dynamic> info) {
    return {
      if (info['key'] != null) 'key': info['key'],
      if (info['ancestorKey'] != null) 'ancestorKey': info['ancestorKey'],
      if (info['name'] != null) 'name': info['name'],
      if (info['semanticsId'] != null) 'semanticsId': info['semanticsId'],
      if (info['semanticsLabel'] != null)
        'semanticsLabel': info['semanticsLabel'],
      if (info['semanticsHint'] != null) 'semanticsHint': info['semanticsHint'],
      if (info['role'] != null) 'role': info['role'],
    };
  }

  static Map<String, dynamic>? _extractNamedField(
    Element element,
    String name,
  ) {
    final info = InspectExtension.extractWidgetInfo(element);
    if (info == null) return null;

    final value = _fieldValue(element);
    final options = _collectOptions(element, value);
    final controlType = _inferControlType(element, value, options);
    if (controlType == null) return null;

    final label = _fieldLabel(element);
    final selector = _selectorFor(
      info,
      label: label,
      fallbackType: info['type']?.toString(),
    );

    return {
      'id': info['id'],
      'type': info['type'],
      'controlType': controlType,
      if (info['rect'] != null) 'rect': info['rect'],
      ..._stableMetadata(info),
      if (label != null) 'label': label,
      'name': name,
      'obscureText': false,
      'enabled': _fieldEnabled(element),
      if (value != null) 'value': _jsonValue(value),
      if (options.isNotEmpty) 'options': options,
      'selector': selector,
    };
  }

  static String? _inferControlType(
    Element element,
    Object? value,
    List<Map<String, dynamic>> options,
  ) {
    if (_hasSemanticRole(element, 'checkbox')) return 'checkbox';
    if (value is bool) {
      return options.length > 1 ? 'radio' : 'checkbox';
    }
    if (_looksLikeBooleanOptions(options)) return 'radio';
    if (value is Iterable || value is num) {
      return options.isEmpty ? null : 'checkbox';
    }
    if (value is String) return 'select';
    if (options.length > 1) return 'select';
    return null;
  }

  static bool _looksLikeBooleanOptions(List<Map<String, dynamic>> options) {
    final values = options
        .map((option) => (option['value'] ?? option['label'])
            .toString()
            .trim()
            .toLowerCase())
        .toSet();
    final labels = options
        .map((option) => option['label'].toString().trim().toLowerCase())
        .toSet();
    return options.length >= 2 &&
        (values.contains('true') && values.contains('false') ||
            labels.contains('yes') && labels.contains('no') ||
            labels.contains('是') && labels.contains('否'));
  }

  static List<Map<String, dynamic>> _collectOptions(
    Element element,
    Object? currentValue,
  ) {
    final byLabel = <String, Map<String, dynamic>>{};

    void addOption(
      String? label,
      Object? value, {
      String? semanticsId,
      bool? selected,
    }) {
      final normalizedLabel = label?.trim();
      if (normalizedLabel == null || normalizedLabel.isEmpty) return;
      byLabel.putIfAbsent(normalizedLabel, () {
        final option = <String, dynamic>{
          'label': normalizedLabel,
          if (value != null) 'value': _jsonValue(value).toString(),
          if (semanticsId != null && semanticsId.isNotEmpty)
            'semanticsId': semanticsId,
          if (selected != null) 'selected': selected,
          'enabled': true,
        };
        return option;
      });
    }

    void visit(Element candidate) {
      final widget = candidate.widget;
      final widgetOptions = _readOptions(widget);
      final labelBuilder = _readAny(widget, 'labelBuilder');
      final optionSemanticsIdentifierBuilder =
          _readAny(widget, 'optionSemanticsIdentifierBuilder');
      for (final option in widgetOptions) {
        final label = _optionLabel(option, labelBuilder);
        final optionValue = _optionValue(option);
        addOption(
          label,
          optionValue,
          semanticsId:
              _optionSemanticsId(option, optionSemanticsIdentifierBuilder),
          selected: _optionSelected(optionValue, label, currentValue),
        );
      }

      final text = InspectExtension.extractText(widget);
      if (text != null) {
        final selected = _readBool(widget, 'selected');
        addOption(text, text, selected: selected);
      }

      candidate.visitChildren(visit);
    }

    element.visitChildren(visit);
    return byLabel.values.toList();
  }

  static List<Object?> _readOptions(Widget widget) {
    final options = _readAny(widget, 'options');
    if (options is Iterable) return options.toList();
    final countries = _readAny(widget, 'countries');
    if (countries is Iterable) return countries.toList();
    return const [];
  }

  static String? _optionLabel(Object? option, Object? labelBuilder) {
    if (labelBuilder != null) {
      try {
        final dynamic builder = labelBuilder;
        final built = builder(option);
        if (built is String && built.trim().isNotEmpty) return built;
      } catch (_) {
        // Fall back to common label-like properties.
      }
    }
    final label = _readString(option, 'label') ??
        _readString(option, 'name') ??
        _readString(option, 'title');
    if (label != null) return label;
    return option?.toString();
  }

  static Object? _optionValue(Object? option) {
    if (option == null || option is String || option is num || option is bool) {
      return option;
    }
    return _readAny(option, 'value') ??
        _readAny(option, 'alpha2Code') ??
        _readAny(option, 'code') ??
        _readAny(option, 'bit') ??
        option.toString();
  }

  static String? _optionSemanticsId(
    Object? option,
    Object? optionSemanticsIdentifierBuilder,
  ) {
    if (optionSemanticsIdentifierBuilder == null) return null;
    try {
      final dynamic builder = optionSemanticsIdentifierBuilder;
      final built = builder(option);
      if (built is String && built.trim().isNotEmpty) return built;
    } catch (_) {
      return null;
    }
    return null;
  }

  static bool _optionSelected(
    Object? optionValue,
    String? optionLabel,
    Object? currentValue,
  ) {
    if (currentValue == null) return false;
    final value = _jsonValue(optionValue).toString();
    if (currentValue is Iterable) {
      return currentValue
          .map((item) => _jsonValue(item).toString())
          .contains(value);
    }
    if (currentValue is int && optionValue is int) {
      return currentValue & optionValue != 0;
    }
    final current = _jsonValue(currentValue).toString();
    return current == value || current == optionLabel;
  }

  static String? _fieldLabel(Element element) {
    String? result;
    void visit(Element candidate) {
      if (result != null) return;
      final widget = candidate.widget;
      result = _readString(widget, 'placeholder') ??
          _readString(widget, 'hintText') ??
          InspectExtension.extractText(widget);
      if (result != null && result!.trim().isEmpty) result = null;
      candidate.visitChildren(visit);
    }

    element.visitChildren(visit);
    return result;
  }

  static Object? _fieldValue(Element element) {
    if (element is StatefulElement) {
      final state = element.state;
      final value = _readAny(state, 'value');
      if (value != null) return value;
    }
    return _readAny(element.widget, 'initialValue');
  }

  static bool _fieldEnabled(Element element) {
    return _readBool(element.widget, 'enabled') ??
        !(_readBool(element.widget, 'disabled') ?? false);
  }

  static Object _jsonValue(Object? value) {
    if (value == null) return '';
    if (value is String || value is num || value is bool) return value;
    if (value is Iterable) {
      return value.map((item) => _jsonValue(item).toString()).toList();
    }
    return value.toString();
  }

  static bool _hasEditableDescendant(Element element) {
    var found = false;
    void visit(Element candidate) {
      if (found) return;
      if (candidate.widget is EditableText || candidate.widget is TextField) {
        found = true;
        return;
      }
      candidate.visitChildren(visit);
    }

    element.visitChildren(visit);
    return found;
  }

  static bool _hasSemanticRole(Element element, String role) {
    var found = false;
    void visit(Element candidate) {
      if (found) return;
      if (InspectExtension.extractSemantics(candidate).role == role) {
        found = true;
        return;
      }
      candidate.visitChildren(visit);
    }

    visit(element);
    return found;
  }

  static Object? _readAny(Object? target, String name) {
    if (target == null) return null;
    try {
      final dynamic value = target;
      switch (name) {
        case 'alpha2Code':
          return value.alpha2Code;
        case 'bit':
          return value.bit;
        case 'code':
          return value.code;
        case 'countries':
          return value.countries;
        case 'disabled':
          return value.disabled;
        case 'enabled':
          return value.enabled;
        case 'hintText':
          return value.hintText;
        case 'initialValue':
          return value.initialValue;
        case 'label':
          return value.label;
        case 'labelBuilder':
          return value.labelBuilder;
        case 'name':
          return value.name;
        case 'options':
          return value.options;
        case 'optionSemanticsIdentifierBuilder':
          return value.optionSemanticsIdentifierBuilder;
        case 'placeholder':
          return value.placeholder;
        case 'selected':
          return value.selected;
        case 'title':
          return value.title;
        case 'value':
          return value.value;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  static String? _readString(Object? target, String name) {
    final value = _readAny(target, name);
    return value is String && value.isNotEmpty ? value : null;
  }

  static bool? _readBool(Object? target, String name) {
    final value = _readAny(target, name);
    return value is bool ? value : null;
  }

  static String _selectorFor(
    Map<String, dynamic> info, {
    String? hintText,
    String? label,
    String? fallbackType,
  }) {
    final semanticsId = info['semanticsId'];
    if (semanticsId is String && semanticsId.isNotEmpty) {
      return jsonEncode({
        'match': {'semanticIdentifier': semanticsId},
      });
    }

    final name = info['name'];
    if (name is String && name.isNotEmpty) {
      return jsonEncode({
        'match': {'name': name},
      });
    }

    final key = info['key'];
    if (key is String && key.isNotEmpty) {
      return jsonEncode({
        'match': {'key': key},
      });
    }

    final ancestorKey = info['ancestorKey'];
    if (ancestorKey is String && ancestorKey.isNotEmpty) {
      return jsonEncode({
        'match': {'type': fallbackType ?? info['type']},
        'within': {
          'match': {'key': ancestorKey},
        },
      });
    }

    if (hintText != null && hintText.isNotEmpty) {
      return jsonEncode({
        'match': {'textContains': hintText},
        'fallback': {'hintText': hintText},
      });
    }
    if (label != null && label.isNotEmpty) {
      return jsonEncode({
        'match': {'textContains': label},
        'fallback': {'semanticsLabel': label},
      });
    }
    return jsonEncode({
      'match': {'type': fallbackType ?? info['type']},
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

  static void _markNamedFieldSeen(
    Element element,
    Set<String> seenNamedFields,
  ) {
    element.visitAncestorElements((ancestor) {
      final name = _readString(ancestor.widget, 'name');
      if (name != null) {
        seenNamedFields.add(name);
        return false;
      }
      if (ancestor.widget is Scaffold || ancestor.widget is WidgetsApp) {
        return false;
      }
      return true;
    });
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
