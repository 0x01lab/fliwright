import 'package:flutter/widgets.dart';

import '../bridge.dart';
import 'inspect.dart';

class SourceMapExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.sourceMap', _sourceMap);
  }

  static Future<Map<String, dynamic>> _sourceMap(
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {
        'success': false,
        'error': 'No widget tree available',
        'widgetCreationTracked': _isWidgetCreationTracked(),
        'nodes': <dynamic>[],
        'candidateFiles': <dynamic>[],
        'count': 0,
      };
    }

    final includeFramework = params['includeFramework'] == 'true';
    final includeRects = (params['includeRects'] ?? 'true') != 'false';
    final includeProperties = params['includeProperties'] == 'true';
    final limit = int.tryParse(params['limit'] ?? '');
    final nodes = <Map<String, dynamic>>[];
    final fileCounts = <String, int>{};

    InspectExtension.walkTreeUntil(root, (element) {
      if (limit != null && nodes.length >= limit) return false;
      final info = InspectExtension.extractWidgetInfo(element);
      if (info == null) return true;

      final source = _sourceFor(element);
      if (!includeFramework && _isFrameworkSource(source)) return true;
      if (source != null) {
        final file = source['file']?.toString();
        if (file != null && file.isNotEmpty) {
          fileCounts[file] = (fileCounts[file] ?? 0) + 1;
        }
      }

      final text = info['text']?.toString();
      final label = info['semanticsLabel']?.toString() ??
          text ??
          info['semanticsHint']?.toString() ??
          info['key']?.toString() ??
          info['name']?.toString();
      final node = <String, dynamic>{
        'id': info['id'],
        'type': info['type'],
        if (label != null && label.isNotEmpty) 'label': label,
        if (text != null) 'text': text,
        if (info['key'] != null) 'key': info['key'],
        if (info['role'] != null) 'role': info['role'],
        if (includeRects && info['rect'] != null) 'rect': info['rect'],
        if (source != null) 'source': source,
        if (includeProperties) 'properties': info['properties'],
      };

      if (node.containsKey('label') ||
          node.containsKey('key') ||
          node.containsKey('role') ||
          node.containsKey('source')) {
        nodes.add(node);
      }
      return true;
    });

    final candidateFiles = fileCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    return {
      'success': true,
      'widgetCreationTracked': _isWidgetCreationTracked(),
      'route': await _route(),
      'nodes': nodes,
      'candidateFiles': candidateFiles.map((entry) => entry.key).toList(),
      'fileCounts': {
        for (final entry in candidateFiles) entry.key: entry.value,
      },
      'count': nodes.length,
    };
  }

  static Map<String, dynamic>? _sourceFor(Element element) {
    final json = element.toDiagnosticsNode().toJsonMap(
          InspectorSerializationDelegate(
            service: WidgetInspectorService.instance,
            subtreeDepth: 0,
            includeProperties: false,
          ),
        );
    final location = json['creationLocation'];
    if (location is! Map) return null;
    final file = location['file']?.toString();
    final line = _asInt(location['line']);
    final column = _asInt(location['column']);
    if (file == null || file.isEmpty || line == null || column == null) {
      return null;
    }
    return {
      'file': file,
      'line': line,
      'column': column,
      if (location['name'] != null) 'name': location['name'],
    };
  }

  static bool _isWidgetCreationTracked() {
    try {
      return WidgetInspectorService.instance.isWidgetCreationTracked();
    } catch (_) {
      return false;
    }
  }

  static bool _isFrameworkSource(Map<String, dynamic>? source) {
    final file = source?['file']?.toString();
    if (file == null) return false;
    return file.startsWith('package:flutter/') ||
        file.contains('/packages/flutter/');
  }

  static int? _asInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '');
  }

  static Future<Map<String, dynamic>> _route() async {
    try {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.currentRoute',
        {},
      );
      return {
        'location': result['fullUri'] ?? result['path'],
        'name': result['name'],
      };
    } catch (_) {
      return {'location': null, 'name': null};
    }
  }
}
