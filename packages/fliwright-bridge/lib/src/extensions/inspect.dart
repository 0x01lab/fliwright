import 'dart:convert';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../actionability_gate.dart';
import '../bridge.dart';
import '../ref_registry.dart';
import '../semantics_compat.dart';

class InspectExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.inspect', _inspect);
    registry.register('ext.fliwright.resolve', _resolve);
    registry.register('ext.fliwright.action', _action);
  }

  static Future<Map<String, dynamic>> _resolve(
    Map<String, String> params,
  ) async {
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
      final contextDump = _buildContextDump(root, limit: 20);
      return {
        'success': false,
        'error': 'No widget found matching selector',
        'matches': matchedWidgets,
        'count': totalMatches,
        'visited': visited,
        'contextDump': contextDump,
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
    Map<String, String> params,
  ) async {
    final action = params['action'] ?? '';
    if (action.isEmpty) {
      return {'error': 'Missing required parameter: action', 'success': false};
    }

    if (action == 'dismissModal') {
      return _dismissModal();
    }
    if (action == 'waitForNetworkIdle') {
      return _waitForNetworkIdle(params);
    }

    final ref = params['ref'];
    if (ref != null && ref.isNotEmpty) {
      final entry = RefRegistry.lookupEntry(ref) ?? _resolveQueryRef(ref);
      if (entry == null) {
        return {'error': 'Unknown or stale ref: $ref', 'success': false};
      }
      try {
        await ensureActionable(
          entry,
          ref: ref,
          checkStable: params['checkStable'] != 'false',
          checkReceivesEvents: params['checkReceivesEvents'] == 'true',
        );
      } on ActionabilityException catch (error) {
        return {
          'error': error.reason,
          'success': false,
          'actionability': {'ref': ref, 'reason': error.reason},
        };
      }
      final rect = {
        'x': entry.rect.left,
        'y': entry.rect.top,
        'width': entry.rect.width,
        'height': entry.rect.height,
      };
      return _actionWithResolvedTarget(
        action: action,
        rect: rect,
        targetId: '${entry.element.hashCode}',
        params: {...params, 'selector': params['selector'] ?? 'ref=$ref'},
      );
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
        'success': false,
      };
    }

    return _actionWithResolvedTarget(
      action: action,
      rect: rect,
      targetId: target['id'].toString(),
      params: params,
    );
  }

  static Future<Map<String, dynamic>> _actionWithResolvedTarget({
    required String action,
    required Map<String, dynamic> rect,
    required String targetId,
    required Map<String, String> params,
  }) async {
    switch (action) {
      case 'tap':
        final tapResult = await _tap(rect, params);
        if (params['waitForAnimations'] == 'true') {
          await FliwrightBridge.registry.invoke('ext.fliwright.settle', {
            'timeout': params['settleTimeout'] ?? '2000',
          });
        }
        return tapResult;
      case 'doubleClick':
        return _tapMultiple(rect, params, 2, 'doubleClick');
      case 'tripleClick':
        return _tapMultiple(rect, params, 3, 'tripleClick');
      case 'rightClick':
        return _tap(rect, {...params, 'button': 'right'});
      case 'hover':
        return _hover(rect, params);
      case 'focus':
        return _tap(rect, params);
      case 'blur':
        FocusManager.instance.primaryFocus?.unfocus();
        return {'success': true, 'action': 'blur'};
      case 'pressKey':
        return FliwrightBridge.registry.invoke('ext.fliwright.type', {
          ...params,
          'selector': params['selector'] ?? '',
          'targetId': targetId,
          'targetRect': jsonEncode(rect),
          'key': params['key'] ?? params['value'] ?? '',
        });
      case 'setCheckbox':
        return _setCheckbox(rect, targetId, params);
      case 'selectOption':
        return _selectOption(targetId, params);
      case 'longPress':
      case 'drag':
      case 'semanticDrag':
      case 'slideTo':
      case 'pinch':
        return FliwrightBridge.registry.invoke('ext.fliwright.gesture', {
          ...params,
          'selector': params['selector'] ?? '',
          'resolvedRect': jsonEncode(rect),
          'gesture': action,
        });
      case 'type':
      case 'fill':
      case 'clear':
        return FliwrightBridge.registry.invoke('ext.fliwright.type', {
          ...params,
          'selector': params['selector'] ?? '',
          'targetId': targetId,
          'targetRect': jsonEncode(rect),
          'replaceAll':
              params['replaceAll'] ??
              (action == 'fill' || action == 'clear' ? 'true' : 'false'),
          if (action == 'clear') 'text': '',
        });
      case 'scrollIntoView':
        return FliwrightBridge.registry.invoke('ext.fliwright.scrollIntoView', {
          ...params,
          'selector': params['selector'] ?? '',
          'targetId': targetId,
        });
      default:
        return {'error': 'Unknown action: $action', 'success': false};
    }
  }

  static RefEntry? _resolveQueryRef(String ref) {
    final query = RefRegistry.lookupQuery(ref);
    if (query == null) return null;
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return null;

    Element? match;
    walkTreeUntil(root, (element) {
      if (!_matchesQueryRef(element, query)) return true;
      final renderObject = element.findRenderObject();
      if (renderObject is! RenderBox || !renderObject.hasSize) return true;
      match = element;
      return false;
    });
    final element = match;
    if (element == null) return null;
    final renderObject = element.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.hasSize) return null;
    final rect = renderObject.localToGlobal(Offset.zero) & renderObject.size;
    final info = extractWidgetInfo(element);
    return RefEntry(
      rect: rect,
      element: element,
      groupId: 'query:$ref',
      isTextField: _roleForElement(element, info) == 'textbox',
      renderObject: renderObject,
      semanticsId: int.tryParse(info?['semanticsId']?.toString() ?? ''),
      role: _roleForElement(element, info),
      label: _labelForInfo(info),
      enabled: _enabledForElement(element),
      metadata: {
        if (info?['type'] != null) 'type': info!['type'],
        if (info?['key'] != null) 'key': info!['key'],
      },
    );
  }

  static bool _matchesQueryRef(Element element, QueryRef query) {
    final info = extractWidgetInfo(element);
    if (info == null) return false;

    final text = info['text']?.toString();
    final label = _labelForInfo(info);
    final key = info['key']?.toString();
    final semanticsLabel = info['semanticsLabel']?.toString();
    final type =
        info['type']?.toString() ?? element.widget.runtimeType.toString();
    final role = _roleForElement(element, info);

    if (query.text != null && text != query.text && label != query.text) {
      return false;
    }
    if (query.containsText != null) {
      final needle = query.containsText!;
      if ((text == null || !text.contains(needle)) &&
          (label == null || !label.contains(needle))) {
        return false;
      }
    }
    if (query.key != null && key != query.key) return false;
    if (query.semanticsLabel != null &&
        (semanticsLabel == null ||
            !semanticsLabel.contains(query.semanticsLabel!))) {
      return false;
    }
    if (query.role != null && role != query.role) return false;
    if (query.type != null && type != query.type) return false;
    return true;
  }

  static Future<Map<String, dynamic>> _inspect(
    Map<String, String> params,
  ) async {
    final selector = params['selector'] ?? '';
    if (_looksLikeJsonSelector(selector)) {
      final result = await _resolve(params);
      return {...result, 'widgets': result['matches'] ?? <dynamic>[]};
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
    return FliwrightBridge.registry.invoke('ext.fliwright.click', {
      'x': point.dx.toString(),
      'y': point.dy.toString(),
      if (params['button'] != null) 'button': params['button']!,
    });
  }

  static Future<Map<String, dynamic>> _tapMultiple(
    Map<String, dynamic> rect,
    Map<String, String> params,
    int count,
    String action,
  ) async {
    for (var i = 0; i < count; i++) {
      final result = await _tap(rect, params);
      if (result['success'] == false || result['error'] != null) return result;
    }
    return {'success': true, 'action': action, 'clickCount': count};
  }

  static Future<Map<String, dynamic>> _hover(
    Map<String, dynamic> rect,
    Map<String, String> params,
  ) {
    final alignment = _alignmentFromString(params['alignment'] ?? 'center');
    final point = _pointInRect(rect, alignment);
    return FliwrightBridge.registry.invoke('ext.fliwright.hover', {
      'x': point.dx.toString(),
      'y': point.dy.toString(),
    });
  }

  static Future<Map<String, dynamic>> _setCheckbox(
    Map<String, dynamic> rect,
    String targetId,
    Map<String, String> params,
  ) async {
    final expected = _parseBool(params['checked'] ?? params['value']);
    if (expected == null) {
      return {
        'error': 'setCheckbox requires checked=true or checked=false',
        'success': false,
      };
    }

    final element = _findElementById(targetId);
    if (element == null) {
      return {'error': 'Target element not found: $targetId', 'success': false};
    }
    final current = _checkedValueOf(element.widget);
    if (current == null) {
      return {
        'error': 'Target is not a Checkbox, Switch, or Radio: $targetId',
        'success': false,
      };
    }
    if (current == expected) {
      return {'success': true, 'action': 'setCheckbox', 'checked': expected};
    }

    final tap = await _tap(rect, params);
    if (tap['success'] == false || tap['error'] != null) return tap;
    return {'success': true, 'action': 'setCheckbox', 'checked': expected};
  }

  static Future<Map<String, dynamic>> _selectOption(
    String targetId,
    Map<String, String> params,
  ) async {
    final desired = params['value'] ?? params['label'];
    if (desired == null || desired.isEmpty) {
      return {
        'error': 'selectOption requires value or label',
        'success': false,
      };
    }
    final element = _findElementById(targetId);
    if (element == null) {
      return {'error': 'Target element not found: $targetId', 'success': false};
    }

    try {
      final dynamic widget = element.widget;
      final dynamic items = widget.items;
      final dynamic onChanged = widget.onChanged;
      if (items is! Iterable || onChanged == null) {
        return {
          'error': 'Target does not expose dropdown items/onChanged',
          'success': false,
        };
      }

      for (final dynamic item in items) {
        final value = item.value;
        final label = _dropdownItemLabel(item);
        if (value?.toString() == desired || label == desired) {
          onChanged(value);
          return {
            'success': true,
            'action': 'selectOption',
            'value': value?.toString(),
            if (label != null) 'label': label,
          };
        }
      }
      return {
        'error': 'No dropdown option matched: $desired',
        'success': false,
      };
    } catch (error) {
      return {'error': 'selectOption failed: $error', 'success': false};
    }
  }

  static Future<Map<String, dynamic>> _dismissModal() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'error': 'No widget tree available', 'success': false};
    }
    final navigator = Navigator.maybeOf(root);
    final popped = navigator == null ? false : await navigator.maybePop();
    return {'success': true, 'action': 'dismissModal', 'popped': popped};
  }

  static Future<Map<String, dynamic>> _waitForNetworkIdle(
    Map<String, String> params,
  ) async {
    final quietMs = int.tryParse(params['quietMs'] ?? '') ?? 500;
    final timeoutMs = int.tryParse(params['timeout'] ?? '') ?? 5000;
    final started = DateTime.now();

    Future<int?> callCount() async {
      try {
        final state = await FliwrightBridge.registry.invoke(
          'ext.fliwright.mock.debugState',
          {},
        );
        final calls = state['calls'];
        return calls is int ? calls : int.tryParse(calls?.toString() ?? '');
      } catch (_) {
        return null;
      }
    }

    var previous = await callCount();
    if (previous == null) {
      return {
        'error':
            'Network idle requires the Fliwright mock debug extension to be registered',
        'success': false,
      };
    }

    while (DateTime.now().difference(started).inMilliseconds < timeoutMs) {
      await Future<void>.delayed(Duration(milliseconds: quietMs));
      final current = await callCount();
      if (current == previous) {
        return {
          'success': true,
          'action': 'waitForNetworkIdle',
          'quietMs': quietMs,
          'calls': current,
        };
      }
      previous = current;
    }
    return {
      'error': 'Timeout waiting for network idle',
      'success': false,
      'quietMs': quietMs,
      'timeout': timeoutMs,
    };
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
    final andFields = query['and'];
    final orFields = query['or'];
    final filter = query['filter'];
    final containing = query['containing'];

    // Handle top-level and/or composition
    if (andFields is List) {
      var ast = <String, dynamic>{
        'kind': 'and',
        'selectors': andFields
            .whereType<Map<String, dynamic>>()
            .map(_queryToAst)
            .toList(),
      };
      if (filter is Map<String, dynamic>) {
        ast = {'kind': 'filter', 'selector': ast, 'filter': filter};
      }
      if (position is Map<String, dynamic>) {
        final nth = position['nth'];
        if (nth is int) {
          ast = {'kind': 'nth', 'selector': ast, 'index': nth};
        } else if (position['first'] == true) {
          ast = {'kind': 'nth', 'selector': ast, 'index': 0};
        } else if (position['last'] == true) {
          ast = {'kind': 'last', 'selector': ast};
        }
      }
      return ast;
    }
    if (orFields is List) {
      var ast = <String, dynamic>{
        'kind': 'or',
        'selectors': orFields
            .whereType<Map<String, dynamic>>()
            .map(_queryToAst)
            .toList(),
      };
      if (filter is Map<String, dynamic>) {
        ast = {'kind': 'filter', 'selector': ast, 'filter': filter};
      }
      if (position is Map<String, dynamic>) {
        final nth = position['nth'];
        if (nth is int) {
          ast = {'kind': 'nth', 'selector': ast, 'index': nth};
        } else if (position['first'] == true) {
          ast = {'kind': 'nth', 'selector': ast, 'index': 0};
        } else if (position['last'] == true) {
          ast = {'kind': 'last', 'selector': ast};
        }
      }
      return ast;
    }

    final fallbackAst = fallback is Map<String, dynamic>
        ? _fallbackCriteriaToAst(fallback)
        : null;
    var ast = _matchCriteriaToAst(match is Map<String, dynamic> ? match : null);
    if (ast != null && fallbackAst != null) {
      ast = {'kind': 'fallback', 'primary': ast, 'fallback': fallbackAst};
    } else if (ast == null) {
      ast = fallbackAst;
    }
    ast ??= {'kind': 'type', 'value': 'Widget'};

    if (within is Map<String, dynamic>) {
      ast = {'kind': 'descendant', 'of': _queryToAst(within), 'matching': ast};
    }

    if (containing is Map<String, dynamic>) {
      ast = {
        'kind': 'containing',
        'parent': ast,
        'descendant': _queryToAst(containing),
      };
    }

    if (filter is Map<String, dynamic>) {
      ast = {'kind': 'filter', 'selector': ast, 'filter': filter};
    }

    if (position is Map<String, dynamic>) {
      final nth = position['nth'];
      if (nth is int) {
        ast = {'kind': 'nth', 'selector': ast, 'index': nth};
      } else if (position['first'] == true) {
        ast = {'kind': 'nth', 'selector': ast, 'index': 0};
      } else if (position['last'] == true) {
        ast = {'kind': 'last', 'selector': ast};
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
    addValue('subtype', 'subtype');
    addValue('key', 'key');
    addValue('id', 'id');
    addValue('name', 'name');
    addValue('ancestorKey', 'ancestorKey');
    addValue('tooltip', 'tooltip');

    final text = match['text'];
    if (text is String && text.isNotEmpty) {
      selectors.add({'kind': 'text', 'value': text, 'match': 'exact'});
    }
    final textContains = match['textContains'];
    if (textContains is String && textContains.isNotEmpty) {
      selectors.add({
        'kind': 'text',
        'value': textContains,
        'match': 'contains',
      });
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

    final enabled = match['enabled'];
    if (enabled is bool) {
      selectors.add({'kind': 'state', 'property': 'enabled', 'value': enabled});
    }
    final checked = match['checked'];
    if (checked is bool) {
      selectors.add({'kind': 'state', 'property': 'checked', 'value': checked});
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
      return {'kind': 'semantics', 'hint': semanticsHint, 'match': 'contains'};
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
        return ParsedSelectorAst({
          'kind': 'text',
          'value': selector.value,
          'match': 'exact',
        });
      case 'key':
      case 'type':
      case 'id':
      case 'name':
      case 'ancestorKey':
        return ParsedSelectorAst({
          'kind': selector.field,
          'value': selector.value,
        });
      case 'semanticsId':
        return ParsedSelectorAst({
          'kind': 'semantics',
          'identifier': selector.value,
        });
      case 'semanticsLabel':
        return ParsedSelectorAst({
          'kind': 'semantics',
          'label': selector.value,
          'match': 'contains',
        });
      case 'role':
        return ParsedSelectorAst({'kind': 'semantics', 'role': selector.value});
      case 'tooltip':
        return ParsedSelectorAst({'kind': 'tooltip', 'value': selector.value});
      default:
        return ParsedSelectorAst({
          'kind': 'text',
          'value': selector.value,
          'match': 'exact',
        });
    }
  }

  static List<Element> _evaluateSelector(
    Element root,
    ParsedSelectorAst selector,
  ) {
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
            .where(
              (element) => selector
                  .children('selectors')
                  .every((child) => _matchesAst(element, child)),
            )
            .toList();
      case 'or':
        return _dedupeElements(
          selector
              .children('selectors')
              .expand((child) => _evaluateSelector(root, child))
              .toList(),
        );
      case 'nth':
        final candidates = _evaluateSelector(root, selector.child('selector'));
        final index = selector.intValue('index') ?? -1;
        if (index < 0 || index >= candidates.length) return <Element>[];
        return <Element>[candidates[index]];
      case 'last':
        final candidates = _evaluateSelector(root, selector.child('selector'));
        if (candidates.isEmpty) return <Element>[];
        return <Element>[candidates.last];
      case 'filter':
        final candidates = _evaluateSelector(root, selector.child('selector'));
        final filter = selector.value['filter'];
        if (filter is! Map<String, dynamic>) return candidates;
        return candidates
            .where((element) => _passesFilter(element, filter))
            .toList();
      case 'containing':
        final parents = _evaluateSelector(root, selector.child('parent'));
        final descAst = selector.child('descendant');
        final result = <Element>[];
        for (final parent in parents) {
          bool hasMatch = false;
          _walkTreeCollect(parent, (element) {
            if (identical(element, parent)) return false;
            if (_matchesAst(element, descAst)) {
              hasMatch = true;
              return false;
            }
            return true;
          }, []);
          if (hasMatch) result.add(parent);
        }
        return _dedupeElements(result);
      case 'fallback':
        final primary = _evaluateSelector(root, selector.child('primary'));
        if (primary.isNotEmpty) return primary;
        return _evaluateSelector(root, selector.child('fallback'));
      default:
        final result = <Element>[];
        _walkTreeCollect(
          root,
          (element) => _matchesAst(element, selector),
          result,
        );
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
        return _keyMatches(widget.key, selector.stringValue('value')!);
      case 'type':
        return widget.runtimeType.toString() == selector.stringValue('value');
      case 'subtype':
        // Aligned with Flutter native find.bySubtype<T>() — uses 'is' check
        final subtypeName = selector.stringValue('value') ?? '';
        if (subtypeName.isEmpty) return false;
        return _isSubtype(widget.runtimeType.toString(), subtypeName);
      case 'id':
        return '${element.hashCode}' == selector.stringValue('value');
      case 'name':
        return (extractName(widget) ?? findAncestorName(element)) ==
            selector.stringValue('value');
      case 'ancestorKey':
        return findAncestorKey(element) == selector.stringValue('value');
      case 'tooltip':
        return _extractTooltip(element) == selector.stringValue('value');
      case 'state':
        final property = selector.stringValue('property');
        final expected = selector.boolValue('value');
        if (property == 'enabled')
          return _enabledForElement(element) == expected;
        if (property == 'checked') return _checkedValueOf(widget) == expected;
        return false;
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
      case 'last':
      case 'filter':
      case 'containing':
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
    if (selector.startsWith('tooltip=')) {
      return ParsedSelector(field: 'tooltip', value: selector.substring(8));
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
    bool includeDescendantText = false,
    bool includeDescendantIcon = false,
    bool includeTooltip = false,
    bool includeKeyedAncestors = false,
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
    final name = includeName
        ? (extractName(widget) ?? findAncestorName(element))
        : null;
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

    final descendantText = includeDescendantText
        ? findDescendantText(element)
        : null;
    final descendantIcon = includeDescendantIcon
        ? findDescendantIcon(element)
        : null;
    final tooltip = includeTooltip ? extractTooltip(element) : null;
    final keyedAncestors = includeKeyedAncestors
        ? findKeyedAncestors(element)
        : const <Map<String, dynamic>>[];

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
      if (descendantText != null) 'descendantText': descendantText,
      if (descendantIcon != null) 'descendantIcon': descendantIcon,
      if (tooltip != null) 'tooltip': tooltip,
      if (keyedAncestors.isNotEmpty) 'keyedAncestors': keyedAncestors,
      'properties': <String, dynamic>{},
    };
  }

  /// Extracts a string representation from a Key for wire-protocol comparison.
  /// Supports ValueKey<String>, ValueKey<int>, and other ValueKey types via toString().
  /// Aligned with Flutter native find.byKey() where possible.
  static String? extractKeyValue(Key? key) {
    if (key is ValueKey<String>) return key.value;
    if (key is ValueKey<int>) return key.value.toString();
    if (key is ValueKey<double>) return key.value.toString();
    if (key is ValueKey<bool>) return key.value.toString();
    if (key is ValueKey) return key.value.toString();
    return null;
  }

  /// Checks if a widget's key matches the given string value.
  /// Tries both String and numeric comparisons to handle ValueKey<int> etc.
  static bool _keyMatches(Key? key, String expected) {
    if (key == null) return false;
    // Direct string match (ValueKey<String>)
    if (key is ValueKey<String>) return key.value == expected;
    // Numeric key match: try to compare as int or double
    final intVal = int.tryParse(expected);
    if (intVal != null && key is ValueKey<int>) return key.value == intVal;
    final doubleVal = double.tryParse(expected);
    if (doubleVal != null && key is ValueKey<double>)
      return key.value == doubleVal;
    // Fallback: toString comparison for other ValueKey types
    if (key is ValueKey) return key.value.toString() == expected;
    return false;
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

  /// First plain text rendered anywhere in this element's subtree.
  static String? findDescendantText(Element element) {
    String? found;
    void search(Element e) {
      if (found != null) return;
      final w = e.widget;
      if (w is Text) {
        found = w.data;
        return;
      }
      if (w is RichText) {
        found = w.text.toPlainText();
        return;
      }
      if (w is EditableText) {
        found = w.controller.text;
        return;
      }
      e.visitChildren(search);
    }

    element.visitChildren(search);
    return found;
  }

  /// First Icon in this element's subtree, as a wire-protocol map.
  static Map<String, dynamic>? findDescendantIcon(Element element) {
    Map<String, dynamic>? found;
    void search(Element e) {
      if (found != null) return;
      final w = e.widget;
      if (w is Icon && w.icon != null) {
        final data = w.icon!;
        found = {
          'codePoint': data.codePoint,
          'fontFamily': data.fontFamily,
          if (data.fontPackage != null) 'fontPackage': data.fontPackage,
        };
        return;
      }
      e.visitChildren(search);
    }

    element.visitChildren(search);
    return found;
  }

  /// Tooltip exposed by this widget (e.g. IconButton.tooltip) or the
  /// nearest ancestor Tooltip.
  static String? extractTooltip(Element element) {
    final w = element.widget;
    try {
      final t = (w as dynamic).tooltip;
      if (t is String && t.isNotEmpty) return t;
    } catch (_) {
      // Widget exposes no tooltip property.
    }
    String? found;
    element.visitAncestorElements((ancestor) {
      if (ancestor.widget is Tooltip) {
        final message = (ancestor.widget as Tooltip).message;
        if (message is String && message.isNotEmpty) {
          found = message;
          return false;
        }
      }
      if (ancestor.widget is Scaffold || ancestor.widget is WidgetsApp) {
        return false;
      }
      return true;
    });
    return found;
  }

  /// Up to [maxDepth] ancestors that carry a ValueKey, nearest-first.
  /// Records the keyed ancestor (including a keyed Scaffold) before stopping
  /// at the Scaffold/App boundary, so a Scaffold-supplied key is exposed to
  /// the recorder. Framework plumbing keys (e.g. `_ScaffoldSlot.body`) are
  /// skipped because they are not useful selector anchors.
  static List<Map<String, dynamic>> findKeyedAncestors(
    Element element, {
    int maxDepth = 3,
  }) {
    final result = <Map<String, dynamic>>[];
    element.visitAncestorElements((ancestor) {
      if (result.length >= maxDepth) return false;
      final isBoundary =
          ancestor.widget is Scaffold || ancestor.widget is WidgetsApp;
      final key = extractKeyValue(ancestor.widget.key);
      if (key != null && !key.startsWith('_')) {
        result.add({
          'key': key,
          'type': ancestor.widget.runtimeType.toString(),
        });
      }
      if (isBoundary) return false;
      return true;
    });
    return result;
  }

  static ExtractedSemantics extractSemantics(Element element) {
    // Priority 1: Try RenderObject's debugSemantics (aligned with Flutter native)
    // This captures the final computed semantics after merge/propagation.
    final roResult = _extractSemanticsFromRenderObject(element);
    if (roResult.hasAnyValue) return roResult;

    // Priority 2: Walk the widget tree for Semantics widgets
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

  /// Extracts semantics from the RenderObject's debugSemantics node.
  /// Aligned with Flutter native find.bySemanticsLabel() which reads
  /// from renderObject.debugSemantics rather than the Semantics widget directly.
  static ExtractedSemantics _extractSemanticsFromRenderObject(Element element) {
    if (element is! RenderObjectElement) return const ExtractedSemantics();
    final renderObject = element.renderObject;
    final SemanticsNode? node = renderObject.debugSemantics;
    if (node == null) return const ExtractedSemantics();
    return ExtractedSemantics(
      identifier: node.identifier?.isEmpty == true ? null : node.identifier,
      label: node.label?.isEmpty == true ? null : node.label,
      hint: node.hint?.isEmpty == true ? null : node.hint,
      role: _roleFromSemanticsNode(node),
    );
  }

  static ExtractedSemantics extractOwnSemantics(Element element) {
    // Try RenderObject semantics first (aligned with Flutter native)
    final roResult = _extractSemanticsFromRenderObject(element);
    if (roResult.hasAnyValue) return roResult;

    // Fallback to Semantics widget properties
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

  /// Derives a role string from a SemanticsNode, matching _roleFromProperties.
  static String? _roleFromSemanticsNode(SemanticsNode node) {
    final data = node.getSemanticsData();
    if (!SemanticsCompat.hasAnyFlags(data)) return null;
    // Check in the same order as _roleFromProperties.
    // SemanticsCompat abstracts over SDK version differences.
    if (SemanticsCompat.hasFlag(data, SemanticsFlag.isButton)) return 'button';
    if (SemanticsCompat.hasFlag(data, SemanticsFlag.isLink)) return 'link';
    if (SemanticsCompat.hasFlag(data, SemanticsFlag.isHeader)) return 'header';
    if (SemanticsCompat.hasFlag(data, SemanticsFlag.isTextField))
      return 'textField';
    if (SemanticsCompat.hasFlag(data, SemanticsFlag.isFocused))
      return 'focused';
    if (SemanticsCompat.hasFlag(data, SemanticsFlag.hasCheckedState))
      return 'checkbox';
    if (SemanticsCompat.hasFlag(data, SemanticsFlag.isSelected))
      return 'selected';
    return null;
  }

  /// Builds a lightweight dump of visible widgets on screen for diagnostic
  /// purposes.  Used when a strict selector match finds zero results, so the
  /// caller can see what IS on screen.
  static List<Map<String, dynamic>> _buildContextDump(
    Element root, {
    int limit = 20,
  }) {
    final widgets = <Map<String, dynamic>>[];

    void visitor(Element element) {
      if (widgets.length >= limit) return;

      // Use lightweight extraction — skip semantics to keep it fast.
      final info = extractWidgetInfo(
        element,
        includeAncestorKey: false,
        includeName: false,
        includeSemantics: false,
      );
      if (info == null) return;

      // Only include widgets with some identifying information.
      final text = info['text'] as String?;
      final key = info['key'] as String?;
      final role = info['role'] as String?;
      final semanticsLabel = info['semanticsLabel'] as String?;

      if (text != null ||
          key != null ||
          role != null ||
          semanticsLabel != null) {
        widgets.add({
          'type': info['type'],
          if (text != null) 'text': text,
          if (key != null) 'key': key,
          if (role != null) 'role': role,
          if (semanticsLabel != null) 'semanticsLabel': semanticsLabel,
        });
      }

      element.visitChildren(visitor);
    }

    root.visitChildren(visitor);
    return widgets;
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

  static bool _matches(Map<String, dynamic> info, ParsedSelector selector) {
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
        return _keyMatches(widget.key, selector.value);
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
      case 'tooltip':
        return _extractTooltip(element) == selector.value;
      case 'text':
        final text = extractText(widget);
        return text != null && text.contains(selector.value);
      default:
        final info = extractWidgetInfo(
          element,
          includeAncestorKey: selector.field == 'ancestorKey',
          includeName: selector.field == 'name',
          includeSemantics:
              selector.field == 'semanticsId' ||
              selector.field == 'semanticsLabel' ||
              selector.field == 'role',
        );
        return info != null && _matches(info, selector);
    }
  }

  static String? extractText(Widget widget) {
    if (widget is Text) {
      // Aligned with Flutter native _MatchTextFinder:
      // Use data if non-null, otherwise fallback to textSpan.toPlainText()
      return widget.data ?? widget.textSpan?.toPlainText();
    }
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
    final fontPackage = selector.stringValue('fontPackage');
    if (codePoint == null || data.codePoint != codePoint) return false;
    if (fontFamily != null && data.fontFamily != fontFamily) return false;
    if (fontPackage != null && data.fontPackage != fontPackage) return false;
    return true;
  }

  /// Checks if [typeName] matches the widget's type or any of its supertypes.
  /// Aligned with Flutter native find.bySubtype<T>() — supports inheritance.
  static bool _isSubtype(String actualTypeName, String targetTypeName) {
    // Exact match
    if (actualTypeName == targetTypeName) return true;
    // Common Flutter base types — check against known supertype chains
    const knownSupertypes = <String, Set<String>>{
      'StatelessWidget': {'Widget'},
      'StatefulWidget': {'Widget'},
      'State': {'Widget'},
      'Text': {'StatelessWidget', 'Widget'},
      'RichText': {'StatelessWidget', 'Widget'},
      'EditableText': {'StatefulWidget', 'Widget'},
      'TextField': {'StatefulWidget', 'Widget'},
      'TextFormField': {'StatefulWidget', 'Widget'},
      'ElevatedButton': {'StatelessWidget', 'Widget'},
      'TextButton': {'StatelessWidget', 'Widget'},
      'OutlinedButton': {'StatelessWidget', 'Widget'},
      'IconButton': {'StatelessWidget', 'Widget'},
      'FloatingActionButton': {'StatelessWidget', 'Widget'},
      'ListView': {'BoxScrollView', 'ScrollView', 'StatelessWidget', 'Widget'},
      'GridView': {'BoxScrollView', 'ScrollView', 'StatelessWidget', 'Widget'},
      'SingleChildScrollView': {'StatelessWidget', 'Widget'},
      'Column': {
        'Flex',
        'MultiChildRenderObjectWidget',
        'RenderObjectWidget',
        'Widget',
      },
      'Row': {
        'Flex',
        'MultiChildRenderObjectWidget',
        'RenderObjectWidget',
        'Widget',
      },
      'Container': {'StatelessWidget', 'Widget'},
      'Scaffold': {'StatefulWidget', 'Widget'},
      'AppBar': {'StatefulWidget', 'Widget'},
      'Checkbox': {'StatefulWidget', 'Widget'},
      'Switch': {'StatefulWidget', 'Widget'},
      'Radio': {'StatefulWidget', 'Widget'},
      'Slider': {'StatefulWidget', 'Widget'},
      'Form': {'StatefulWidget', 'Widget'},
      'DropdownButton': {'StatefulWidget', 'Widget'},
      'InkWell': {'StatefulWidget', 'Widget'},
      'GestureDetector': {'StatelessWidget', 'Widget'},
      'Padding': {
        'SingleChildRenderObjectWidget',
        'RenderObjectWidget',
        'Widget',
      },
      'Align': {
        'SingleChildRenderObjectWidget',
        'RenderObjectWidget',
        'Widget',
      },
      'Center': {
        'Align',
        'SingleChildRenderObjectWidget',
        'RenderObjectWidget',
        'Widget',
      },
      'SizedBox': {
        'SingleChildRenderObjectWidget',
        'RenderObjectWidget',
        'Widget',
      },
      'Expanded': {'Flexible', 'ParentDataWidget', 'ProxyWidget', 'Widget'},
      'Flexible': {'ParentDataWidget', 'ProxyWidget', 'Widget'},
      'Stack': {'MultiChildRenderObjectWidget', 'RenderObjectWidget', 'Widget'},
      'Positioned': {'ParentDataWidget', 'ProxyWidget', 'Widget'},
      'Icon': {'StatelessWidget', 'Widget'},
      'Image': {'StatefulWidget', 'Widget'},
      'CircularProgressIndicator': {
        'ProgressIndicator',
        'StatefulWidget',
        'Widget',
      },
      'LinearProgressIndicator': {
        'ProgressIndicator',
        'StatefulWidget',
        'Widget',
      },
      'BottomNavigationBar': {'StatefulWidget', 'Widget'},
      'TabBar': {'StatefulWidget', 'Widget'},
      'TabBarView': {'StatefulWidget', 'Widget'},
      'MaterialApp': {'StatefulWidget', 'Widget'},
      'WidgetsApp': {'StatefulWidget', 'Widget'},
      'Navigator': {'StatefulWidget', 'Widget'},
    };
    final supertypes = knownSupertypes[actualTypeName];
    if (supertypes != null) return supertypes.contains(targetTypeName);
    // For unknown types, check if the type name ends with the target (heuristic)
    // e.g., "_ElevatedButtonState" contains "ElevatedButton"
    return false;
  }

  static bool _passesFilter(Element element, Map<String, dynamic> filter) {
    if (filter['enabled'] == true && _enabledForElement(element) != true) {
      return false;
    }
    if (filter['enabled'] == false && _enabledForElement(element) != false) {
      return false;
    }
    final widget = element.widget;
    if (filter['checked'] == true && _checkedValueOf(widget) != true) {
      return false;
    }
    if (filter['checked'] == false && _checkedValueOf(widget) != false) {
      return false;
    }
    if (filter['visible'] == true &&
        !_isHitTestable(element, Alignment.center)) {
      return false;
    }
    if (filter['visible'] == false &&
        _isHitTestable(element, Alignment.center)) {
      return false;
    }
    final hasText = filter['hasText'];
    if (hasText is String && extractText(widget) != hasText) {
      return false;
    }
    final hasTextContains = filter['hasTextContains'];
    if (hasTextContains is String) {
      final text = extractText(widget);
      if (text == null || !text.contains(hasTextContains)) return false;
    }
    final hasTextRegex = filter['hasTextRegex'];
    if (hasTextRegex is String) {
      final text = extractText(widget);
      if (text == null || !RegExp(hasTextRegex).hasMatch(text)) return false;
    }
    return true;
  }

  static String? _extractTooltip(Element element) {
    final widget = element.widget;

    // Aligned with Flutter native find.byTooltip():
    // 1. Direct Tooltip widget — supports both message and richMessage
    if (widget is Tooltip) {
      final String tooltipMessage =
          widget.message ?? widget.richMessage?.toPlainText() ?? '';
      if (tooltipMessage.isNotEmpty) return tooltipMessage;
    }

    // 2. RawTooltip (Tooltip's base class) — reads semanticsTooltip
    if (widget is RawTooltip) {
      final String? semantics = widget.semanticsTooltip;
      if (semantics != null && semantics.isNotEmpty) return semantics;
    }

    // 3. Widgets with a tooltip property (IconButton, FloatingActionButton, etc.)
    try {
      final dynamic tooltip = (widget as dynamic).tooltip;
      if (tooltip is String && tooltip.isNotEmpty) return tooltip;
    } catch (_) {}

    // 4. Walk ancestors for Tooltip / RawTooltip / tooltip property
    String? result;
    element.visitAncestorElements((ancestor) {
      final aw = ancestor.widget;
      if (aw is Tooltip) {
        result = aw.message ?? aw.richMessage?.toPlainText() ?? '';
        if (result!.isNotEmpty) return false;
      }
      if (aw is RawTooltip) {
        final String? semantics = aw.semanticsTooltip;
        if (semantics != null && semantics.isNotEmpty) {
          result = semantics;
          return false;
        }
      }
      try {
        final dynamic tooltip = (aw as dynamic).tooltip;
        if (tooltip is String && tooltip.isNotEmpty) {
          result = tooltip;
          return false;
        }
      } catch (_) {}
      if (aw is Scaffold || aw is WidgetsApp) return false;
      return true;
    });
    return result;
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
    RenderObject? current = child.parent is RenderObject
        ? child.parent as RenderObject
        : null;
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

  static Element? _findElementById(String id) {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return null;
    Element? match;
    walkTreeUntil(root, (element) {
      if ('${element.hashCode}' != id) return true;
      match = element;
      return false;
    });
    return match;
  }

  static bool? _parseBool(String? value) {
    if (value == null) return null;
    switch (value.toLowerCase()) {
      case 'true':
      case '1':
      case 'yes':
        return true;
      case 'false':
      case '0':
      case 'no':
        return false;
      default:
        return null;
    }
  }

  static bool? _checkedValueOf(Widget widget) {
    if (widget is Checkbox) return widget.value;
    if (widget is Switch) return widget.value;
    if (widget is Radio) {
      final dynamic radio = widget;
      return radio.value == radio.groupValue;
    }
    return null;
  }

  static String? _dropdownItemLabel(dynamic item) {
    try {
      final dynamic child = item.child;
      if (child is Text) return child.data ?? child.textSpan?.toPlainText();
      if (child is RichText) return child.text.toPlainText();
      return child?.toString();
    } catch (_) {
      return null;
    }
  }

  static String? _labelForInfo(Map<String, dynamic>? info) {
    if (info == null) return null;
    return info['semanticsLabel']?.toString() ??
        info['text']?.toString() ??
        info['semanticsHint']?.toString() ??
        info['key']?.toString() ??
        info['name']?.toString();
  }

  static String? _roleForElement(Element element, Map<String, dynamic>? info) {
    final semanticsRole = info?['role']?.toString();
    if (semanticsRole == 'button') return 'button';
    if (semanticsRole == 'link') return 'link';
    if (semanticsRole == 'header') return 'heading';
    if (semanticsRole == 'textField') return 'textbox';
    if (semanticsRole == 'checkbox') return 'checkbox';

    final widget = element.widget;
    if (widget is TextField ||
        widget is TextFormField ||
        widget is EditableText) {
      return 'textbox';
    }
    if (widget is Checkbox || widget is Switch || widget is Radio) {
      return 'checkbox';
    }
    if (widget is ElevatedButton ||
        widget is TextButton ||
        widget is OutlinedButton ||
        widget is IconButton ||
        widget is FloatingActionButton ||
        widget is InkWell ||
        widget is GestureDetector) {
      return 'button';
    }
    if (widget is Text || widget is RichText) return 'text';
    return null;
  }

  static bool? _enabledForElement(Element element) {
    final widget = element.widget;
    if (widget is TextField) return widget.enabled;
    if (widget is ElevatedButton) return widget.onPressed != null;
    if (widget is TextButton) return widget.onPressed != null;
    if (widget is OutlinedButton) return widget.onPressed != null;
    if (widget is IconButton) return widget.onPressed != null;
    if (widget is FloatingActionButton) return widget.onPressed != null;
    if (widget is Checkbox) return widget.onChanged != null;
    if (widget is Switch) return widget.onChanged != null;
    return null;
  }
}

class ExtractedSemantics {
  final String? identifier;
  final String? label;
  final String? hint;
  final String? role;

  const ExtractedSemantics({this.identifier, this.label, this.hint, this.role});

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
