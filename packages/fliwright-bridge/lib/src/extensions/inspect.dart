import 'dart:convert';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../bridge.dart';

class InspectExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.inspect', _inspect);
    registry.register('ext.fliwright.resolve', _resolve);
    registry.register('ext.fliwright.action', _action);
  }

  static Future<Map<String, dynamic>> _resolve(
      Map<String, String> params) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'error': 'No widget tree available', 'matches': <dynamic>[]};
    }

    final selector = _parseSelectorAst(params['selector'] ?? '');
    final limit = int.tryParse(params['limit'] ?? '');
    final strict = (params['strict'] ?? 'false') == 'true';
    final visible = params['visible'] ?? 'any';
    final alignment = _alignmentFromString(params['alignment'] ?? 'center');
    final matchedWidgets = <Map<String, dynamic>>[];
    var totalMatches = 0;
    var visited = 0;

    final selected = _evaluateSelector(root, selector);
    for (final element in selected) {
      visited++;
      if (visible == 'hitTestable' && !_isHitTestable(element, alignment)) {
        continue;
      }
      totalMatches++;
      if (limit == null || matchedWidgets.length < limit) {
        final info = extractWidgetInfo(element);
        if (info != null) {
          info['hitTestable'] = _isHitTestable(element, alignment);
          matchedWidgets.add(info);
        }
      }
    }

    if (strict && totalMatches == 0) {
      return {
        'success': false,
        'error': 'No widget found matching selector',
        'matches': matchedWidgets,
        'count': totalMatches,
        'visited': visited,
      };
    }
    if (strict && totalMatches > 1) {
      return {
        'success': false,
        'error': 'Strict selector matched $totalMatches widgets',
        'matches': matchedWidgets,
        'count': totalMatches,
        'visited': visited,
      };
    }

    return {
      'success': true,
      'matches': matchedWidgets,
      'widgets': matchedWidgets,
      'count': totalMatches,
      'visited': visited,
    };
  }

  static Future<Map<String, dynamic>> _action(
      Map<String, String> params) async {
    final action = params['action'] ?? '';
    if (action.isEmpty) {
      return {'error': 'Missing required parameter: action', 'success': false};
    }

    final resolveParams = Map<String, String>.from(params);
    resolveParams['strict'] = params['strict'] ?? 'true';
    resolveParams['visible'] = params['visible'] ?? 'hitTestable';
    resolveParams['limit'] = params['limit'] ?? '2';
    final resolveResult = await _resolve(resolveParams);
    if (resolveResult['success'] == false) return resolveResult;

    final matches = resolveResult['matches'];
    if (matches is! List || matches.isEmpty) {
      return {'error': 'No widget found matching selector', 'success': false};
    }

    final targetId = params['targetId'];
    final target = targetId == null
        ? matches.first as Map<String, dynamic>
        : matches.cast<Map<String, dynamic>>().firstWhere(
              (candidate) => candidate['id'].toString() == targetId,
              orElse: () => matches.first as Map<String, dynamic>,
            );
    final rect = target['rect'];
    if (rect is! Map<String, dynamic>) {
      return {
        'error': 'Widget matching selector has no render bounds',
        'success': false
      };
    }

    switch (action) {
      case 'tap':
        return _tap(rect, params);
      case 'longPress':
      case 'drag':
      case 'pinch':
        return FliwrightBridge.registry.invoke(
          'ext.fliwright.gesture',
          {
            ...params,
            'selector': params['selector'] ?? '',
            'resolvedRect': jsonEncode(rect),
            'gesture': action,
          },
        );
      case 'type':
      case 'fill':
        return FliwrightBridge.registry.invoke(
          'ext.fliwright.type',
          {
            ...params,
            'selector': params['selector'] ?? '',
            'targetId': target['id'].toString(),
            'targetRect': jsonEncode(rect),
            'replaceAll':
                params['replaceAll'] ?? (action == 'fill' ? 'true' : 'false'),
          },
        );
      case 'scrollIntoView':
        return FliwrightBridge.registry.invoke(
          'ext.fliwright.scrollIntoView',
          {
            ...params,
            'selector': params['selector'] ?? '',
            'targetId': target['id'].toString(),
          },
        );
      default:
        return {'error': 'Unknown action: $action', 'success': false};
    }
  }

  static Future<Map<String, dynamic>> _inspect(
      Map<String, String> params) async {
    final selector = params['selector'] ?? '';
    if (_looksLikeJsonSelector(selector)) {
      final result = await _resolve(params);
      return {
        ...result,
        'widgets': result['matches'] ?? <dynamic>[],
      };
    }
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

  static Future<Map<String, dynamic>> _tap(
    Map<String, dynamic> rect,
    Map<String, String> params,
  ) {
    final alignment = _alignmentFromString(params['alignment'] ?? 'center');
    final point = _pointInRect(rect, alignment);
    return FliwrightBridge.registry.invoke(
      'ext.fliwright.click',
      {'x': point.dx.toString(), 'y': point.dy.toString()},
    );
  }

  static ParsedSelectorAst _parseSelectorAst(String selector) {
    if (selector.isEmpty) {
      throw ArgumentError('Missing parameter: selector');
    }
    if (!_looksLikeJsonSelector(selector)) {
      return _legacyParsedToAst(_parseSelector(selector));
    }
    final decoded = jsonDecode(selector);
    if (decoded is! Map<String, dynamic>) {
      throw ArgumentError('Selector JSON must be an object');
    }
    return ParsedSelectorAst(_queryToAst(decoded));
  }

  static Map<String, dynamic> _queryToAst(Map<String, dynamic> query) {
    if (query['kind'] is String) return query;

    final match = query['match'];
    final fallback = query['fallback'];
    final position = query['position'];
    final within = query['within'];

    final fallbackAst = fallback is Map<String, dynamic>
        ? _fallbackCriteriaToAst(fallback)
        : null;
    var ast = _matchCriteriaToAst(
      match is Map<String, dynamic> ? match : null,
    );
    if (ast != null && fallbackAst != null) {
      ast = {'kind': 'fallback', 'primary': ast, 'fallback': fallbackAst};
    } else if (ast == null) {
      ast = fallbackAst;
    }
    ast ??= {'kind': 'type', 'value': 'Widget'};

    if (within is Map<String, dynamic>) {
      ast = {
        'kind': 'descendant',
        'of': _queryToAst(within),
        'matching': ast,
      };
    }

    if (position is Map<String, dynamic>) {
      final nth = position['nth'];
      if (nth is int) {
        ast = {'kind': 'nth', 'selector': ast, 'index': nth};
      } else if (position['first'] == true) {
        ast = {'kind': 'nth', 'selector': ast, 'index': 0};
      }
    }

    return ast;
  }

  static Map<String, dynamic>? _matchCriteriaToAst(
    Map<String, dynamic>? match,
  ) {
    if (match == null || match.isEmpty) return null;
    final selectors = <Map<String, dynamic>>[];

    void addValue(String source, String kind) {
      final value = match[source];
      if (value is String && value.isNotEmpty) {
        selectors.add({'kind': kind, 'value': value});
      }
    }

    addValue('type', 'type');
    addValue('key', 'key');
    addValue('id', 'id');
    addValue('name', 'name');
    addValue('ancestorKey', 'ancestorKey');

    final text = match['text'];
    if (text is String && text.isNotEmpty) {
      selectors.add({'kind': 'text', 'value': text, 'match': 'exact'});
    }
    final textContains = match['textContains'];
    if (textContains is String && textContains.isNotEmpty) {
      selectors
          .add({'kind': 'text', 'value': textContains, 'match': 'contains'});
    }
    final textRegex = match['textRegex'];
    if (textRegex is String && textRegex.isNotEmpty) {
      selectors.add({'kind': 'text', 'value': textRegex, 'match': 'regex'});
    }

    final semanticIdentifier = match['semanticIdentifier'];
    final semanticsLabel = match['semanticsLabel'];
    final semanticsHint = match['semanticsHint'];
    final role = match['role'];
    if (semanticIdentifier is String ||
        semanticsLabel is String ||
        semanticsHint is String ||
        role is String) {
      selectors.add({
        'kind': 'semantics',
        if (semanticIdentifier is String) 'identifier': semanticIdentifier,
        if (semanticsLabel is String) 'label': semanticsLabel,
        if (semanticsHint is String) 'hint': semanticsHint,
        if (role is String) 'role': role,
        if (semanticsLabel is String || semanticsHint is String)
          'match': 'contains',
      });
    }

    if (selectors.isEmpty) return null;
    if (selectors.length == 1) return selectors.first;
    return {'kind': 'and', 'selectors': selectors};
  }

  static Map<String, dynamic>? _fallbackCriteriaToAst(
    Map<String, dynamic> fallback,
  ) {
    final semanticsLabel = fallback['semanticsLabel'];
    if (semanticsLabel is String && semanticsLabel.isNotEmpty) {
      return {
        'kind': 'semantics',
        'label': semanticsLabel,
        'match': 'contains',
      };
    }
    final semanticsHint = fallback['semanticsHint'];
    if (semanticsHint is String && semanticsHint.isNotEmpty) {
      return {
        'kind': 'semantics',
        'hint': semanticsHint,
        'match': 'contains',
      };
    }
    final hintText = fallback['hintText'] ?? fallback['textContains'];
    if (hintText is String && hintText.isNotEmpty) {
      return {'kind': 'text', 'value': hintText, 'match': 'contains'};
    }
    return null;
  }

  static bool _looksLikeJsonSelector(String selector) {
    final trimmed = selector.trimLeft();
    return trimmed.startsWith('{');
  }

  static ParsedSelectorAst _legacyParsedToAst(ParsedSelector selector) {
    switch (selector.field) {
      case 'text':
        return ParsedSelectorAst(
            {'kind': 'text', 'value': selector.value, 'match': 'exact'});
      case 'key':
      case 'type':
      case 'id':
      case 'name':
      case 'ancestorKey':
        return ParsedSelectorAst(
            {'kind': selector.field, 'value': selector.value});
      case 'semanticsId':
        return ParsedSelectorAst(
            {'kind': 'semantics', 'identifier': selector.value});
      case 'semanticsLabel':
        return ParsedSelectorAst({
          'kind': 'semantics',
          'label': selector.value,
          'match': 'contains'
        });
      case 'role':
        return ParsedSelectorAst({'kind': 'semantics', 'role': selector.value});
      default:
        return ParsedSelectorAst(
            {'kind': 'text', 'value': selector.value, 'match': 'exact'});
    }
  }

  static List<Element> _evaluateSelector(
      Element root, ParsedSelectorAst selector) {
    final kind = selector.kind;
    switch (kind) {
      case 'descendant':
        final parents = _evaluateSelector(root, selector.child('of'));
        final matching = selector.child('matching');
        final result = <Element>[];
        for (final parent in parents) {
          _walkTreeCollect(parent, (element) {
            if (element == parent && selector.boolValue('matchRoot') != true) {
              return false;
            }
            return _matchesAst(element, matching);
          }, result);
        }
        return _dedupeElements(result);
      case 'ancestor':
        final children = _evaluateSelector(root, selector.child('of'));
        final matching = selector.child('matching');
        final result = <Element>[];
        for (final child in children) {
          child.visitAncestorElements((ancestor) {
            if (_matchesAst(ancestor, matching)) result.add(ancestor);
            return true;
          });
        }
        return _dedupeElements(result);
      case 'and':
        return _allElements(root)
            .where((element) => selector
                .children('selectors')
                .every((child) => _matchesAst(element, child)))
            .toList();
      case 'or':
        return _dedupeElements(selector
            .children('selectors')
            .expand((child) => _evaluateSelector(root, child))
            .toList());
      case 'nth':
        final candidates = _evaluateSelector(root, selector.child('selector'));
        final index = selector.intValue('index') ?? -1;
        if (index < 0 || index >= candidates.length) return <Element>[];
        return <Element>[candidates[index]];
      case 'fallback':
        final primary = _evaluateSelector(root, selector.child('primary'));
        if (primary.isNotEmpty) return primary;
        return _evaluateSelector(root, selector.child('fallback'));
      default:
        final result = <Element>[];
        _walkTreeCollect(
            root, (element) => _matchesAst(element, selector), result);
        return result;
    }
  }

  static bool _matchesAst(Element element, ParsedSelectorAst selector) {
    final widget = element.widget;
    switch (selector.kind) {
      case 'text':
        final text = extractText(widget);
        return _matchString(
          text,
          selector.stringValue('value'),
          selector.stringValue('match') ?? 'exact',
          selector.boolValue('caseSensitive') ?? true,
        );
      case 'key':
        return extractKeyValue(widget.key) == selector.stringValue('value');
      case 'type':
        return widget.runtimeType.toString() == selector.stringValue('value');
      case 'id':
        return '${element.hashCode}' == selector.stringValue('value');
      case 'name':
        return (extractName(widget) ?? findAncestorName(element)) ==
            selector.stringValue('value');
      case 'ancestorKey':
        return findAncestorKey(element) == selector.stringValue('value');
      case 'semantics':
        final semantics = extractOwnSemantics(element);
        final identifier = selector.stringValue('identifier');
        final label = selector.stringValue('label');
        final hint = selector.stringValue('hint');
        final role = selector.stringValue('role');
        final match = selector.stringValue('match') ?? 'exact';
        final caseSensitive = selector.boolValue('caseSensitive') ?? true;
        if (identifier != null && semantics.identifier != identifier)
          return false;
        if (role != null && semantics.role != role) return false;
        if (label != null &&
            !_matchString(semantics.label, label, match, caseSensitive))
          return false;
        if (hint != null &&
            !_matchString(semantics.hint, hint, match, caseSensitive))
          return false;
        return identifier != null ||
            label != null ||
            hint != null ||
            role != null;
      case 'icon':
        return _matchesIcon(widget, selector);
      case 'descendant':
      case 'ancestor':
      case 'and':
      case 'or':
      case 'nth':
        return _evaluateSelector(element, selector).contains(element);
      default:
        return false;
    }
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
    final ancestorKey = includeAncestorKey ? findAncestorKey(element) : null;
    final name =
        includeName ? (extractName(widget) ?? findAncestorName(element)) : null;
    final semantics = includeSemantics
        ? extractSemantics(element)
        : const ExtractedSemantics();

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

  static ExtractedSemantics extractOwnSemantics(Element element) {
    final widget = element.widget;
    if (widget is! Semantics) return const ExtractedSemantics();
    final properties = widget.properties;
    return ExtractedSemantics(
      identifier: _readString(properties, 'identifier'),
      label: _readString(properties, 'label'),
      hint: _readString(properties, 'hint'),
      role: _roleFromProperties(properties),
    );
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
        return extractOwnSemantics(element).identifier == selector.value;
      case 'semanticsLabel':
        final label = extractOwnSemantics(element).label;
        return label != null && label.contains(selector.value);
      case 'role':
        return extractOwnSemantics(element).role == selector.value;
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

  static List<Element> _allElements(Element root) {
    final result = <Element>[];
    _walkTreeCollect(root, (_) => true, result);
    return result;
  }

  static void _walkTreeCollect(
    Element root,
    bool Function(Element) predicate,
    List<Element> result,
  ) {
    if (predicate(root)) result.add(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTreeCollect(child, predicate, result);
    });
  }

  static List<Element> _dedupeElements(List<Element> elements) {
    final seen = <int>{};
    final result = <Element>[];
    for (final element in elements) {
      if (seen.add(element.hashCode)) result.add(element);
    }
    return result;
  }

  static bool _matchString(
    String? actual,
    String? expected,
    String match,
    bool caseSensitive,
  ) {
    if (actual == null || expected == null) return false;
    final actualValue = caseSensitive ? actual : actual.toLowerCase();
    final expectedValue = caseSensitive ? expected : expected.toLowerCase();
    switch (match) {
      case 'contains':
        return actualValue.contains(expectedValue);
      case 'regex':
        return RegExp(expected, caseSensitive: caseSensitive).hasMatch(actual);
      case 'exact':
      default:
        return actualValue == expectedValue;
    }
  }

  static bool _matchesIcon(Widget widget, ParsedSelectorAst selector) {
    if (widget is! Icon) return false;
    final data = widget.icon;
    if (data == null) return false;
    final codePoint = selector.intValue('codePoint');
    final fontFamily = selector.stringValue('fontFamily');
    if (codePoint == null || data.codePoint != codePoint) return false;
    if (fontFamily != null && data.fontFamily != fontFamily) return false;
    return true;
  }

  static bool _isHitTestable(Element element, Alignment alignment) {
    final renderObject = element.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.hasSize) return false;

    final rect = renderObject.localToGlobal(Offset.zero) & renderObject.size;
    final point = alignment.withinRect(rect);
    final result = HitTestResult();
    WidgetsBinding.instance.hitTestInView(
      result,
      point,
      WidgetsBinding.instance.platformDispatcher.implicitView?.viewId ?? 0,
    );

    for (final entry in result.path) {
      final target = entry.target;
      if (target == renderObject) return true;
      if (target is RenderObject && _isRenderDescendant(target, renderObject)) {
        return true;
      }
    }
    return false;
  }

  static bool _isRenderDescendant(RenderObject child, RenderObject ancestor) {
    RenderObject? current =
        child.parent is RenderObject ? child.parent as RenderObject : null;
    while (current != null) {
      if (current == ancestor) return true;
      current = current.parent is RenderObject
          ? current.parent as RenderObject
          : null;
    }
    return false;
  }

  static Alignment _alignmentFromString(String value) {
    switch (value) {
      case 'topLeft':
        return Alignment.topLeft;
      case 'topCenter':
        return Alignment.topCenter;
      case 'topRight':
        return Alignment.topRight;
      case 'centerLeft':
        return Alignment.centerLeft;
      case 'centerRight':
        return Alignment.centerRight;
      case 'bottomLeft':
        return Alignment.bottomLeft;
      case 'bottomCenter':
        return Alignment.bottomCenter;
      case 'bottomRight':
        return Alignment.bottomRight;
      case 'center':
      default:
        return Alignment.center;
    }
  }

  static Offset _pointInRect(Map<String, dynamic> rect, Alignment alignment) {
    final x = (rect['x'] as num).toDouble();
    final y = (rect['y'] as num).toDouble();
    final width = (rect['width'] as num).toDouble();
    final height = (rect['height'] as num).toDouble();
    return alignment.withinRect(Rect.fromLTWH(x, y, width, height));
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

class ParsedSelectorAst {
  final Map<String, dynamic> value;

  ParsedSelectorAst(this.value);

  String get kind => value['kind'] as String? ?? '';

  String? stringValue(String key) {
    final raw = value[key];
    return raw is String && raw.isNotEmpty ? raw : null;
  }

  bool? boolValue(String key) {
    final raw = value[key];
    return raw is bool ? raw : null;
  }

  int? intValue(String key) {
    final raw = value[key];
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    return null;
  }

  ParsedSelectorAst child(String key) {
    final raw = value[key];
    if (raw is! Map<String, dynamic>) {
      throw ArgumentError('Selector child "$key" must be an object');
    }
    return ParsedSelectorAst(raw);
  }

  List<ParsedSelectorAst> children(String key) {
    final raw = value[key];
    if (raw is! List) {
      throw ArgumentError('Selector children "$key" must be a list');
    }
    return raw
        .whereType<Map<String, dynamic>>()
        .map(ParsedSelectorAst.new)
        .toList();
  }
}
