import 'dart:convert';

import '../bridge.dart';
import 'inspect.dart';

class QueryExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.query', _query);
  }

  static Future<Map<String, dynamic>> _query(Map<String, String> params) async {
    final decoded = jsonDecode(params['query'] ?? '{}');
    if (decoded is! Map<String, dynamic>) {
      return {
        'success': false,
        'error': 'query must be a JSON object',
        'matches': <dynamic>[],
        'count': 0,
      };
    }
    final ref = decoded['ref'];
    if (ref is String && ref.isNotEmpty) {
      final info = InspectExtension.resolveRefInfo(ref);
      if (info == null) {
        return {
          'success': false,
          'error': 'Unknown or stale ref: $ref',
          'matches': <dynamic>[],
          'count': 0,
        };
      }
      final match = _normalizeMatch(info);
      if (params['visible'] == 'hitTestable' &&
          match['hitTestable'] != true) {
        return {
          'success': true,
          'matches': <dynamic>[],
          'count': 0,
        };
      }
      return {
        'success': true,
        'matches': [match],
        'count': 1,
      };
    }
    final resolved =
        await FliwrightBridge.registry.invoke('ext.fliwright.resolve', {
      'selector': jsonEncode(_selectorFor(decoded)),
      'visible': params['visible'] ?? 'any',
      'strict': 'false',
      if (params['limit'] != null) 'limit': params['limit']!,
    });
    final matches = (resolved['matches'] as List<dynamic>? ?? <dynamic>[])
        .whereType<Map>()
        .map(_normalizeMatch)
        .toList();
    return {
      'success': resolved['success'] ?? true,
      'matches': matches,
      'count': resolved['count'] ?? matches.length,
    };
  }

  static Map<String, dynamic> _selectorFor(Map<String, dynamic> query) {
    final match = <String, dynamic>{};
    if (query['key'] is String) match['key'] = query['key'];
    if (query['text'] is String) match['text'] = query['text'];
    if (query['containsText'] is String) {
      match['textContains'] = query['containsText'];
    }
    if (query['type'] is String) match['type'] = query['type'];
    if (query['role'] is String) match['role'] = query['role'];
    if (query['semanticsLabel'] is String) {
      match['semanticsLabel'] = query['semanticsLabel'];
    }
    if (query['semanticsIdentifier'] is String) {
      match['semanticIdentifier'] = query['semanticsIdentifier'];
    }
    if (match.isEmpty) match['type'] = 'Widget';
    return {'match': match};
  }

  static Map<String, dynamic> _normalizeMatch(Map<dynamic, dynamic> info) {
    final properties = Map<String, dynamic>.from(
      info['properties'] as Map? ?? const <String, dynamic>{},
    );
    final text = info['text']?.toString();
    final semanticsLabel = info['semanticsLabel']?.toString();
    final key = info['key']?.toString();
    final type = info['type']?.toString();
    final role = info['role']?.toString();
    final hitTestable = info['hitTestable'] == true;
    return {
      'ref': info['ref']?.toString() ?? info['id']?.toString(),
      if (role != null) 'role': role,
      'label': semanticsLabel ?? text ?? key ?? type ?? '',
      if (text != null) 'text': text,
      if (properties['value'] != null) 'value': properties['value'],
      if (type != null) 'type': type,
      if (key != null) 'key': key,
      if (info['rect'] != null) 'rect': info['rect'],
      'enabled': properties['enabled'] ?? true,
      'visible': info['rect'] is Map,
      'hitTestable': hitTestable,
      'actionable': hitTestable,
      if (properties['checked'] != null) 'checked': properties['checked'],
      if (properties['selected'] != null) 'selected': properties['selected'],
      'properties': properties,
    };
  }
}
