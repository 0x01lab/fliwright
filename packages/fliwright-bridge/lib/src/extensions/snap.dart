import 'package:flutter/material.dart';

import '../bridge.dart';
import '../ref_registry.dart';
import 'inspect.dart';

class SnapExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.snap', _snap);
  }

  static Future<Map<String, dynamic>> _snap(
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {
        'snapshot': '',
        'groupId': '',
        'refs': <dynamic>[],
        'count': 0,
        'error': 'No widget tree available',
      };
    }

    final maxDepth = int.tryParse(params['depth'] ?? '');
    final includeRects = (params['includeRects'] ?? 'true') != 'false';
    final includeProperties = params['includeProperties'] == 'true';
    final groupId = 'snapshot-${DateTime.now().microsecondsSinceEpoch}';
    final refs = <Map<String, dynamic>>[];
    final buffer = StringBuffer();

    _walkOnstage(root, 0, maxDepth, (element, depth) {
      final candidate = _candidateFor(element);
      if (candidate == null) return;

      final rect = candidate.rect;
      final ref = RefRegistry.registerEntry(
        rect: Rect.fromLTWH(rect.x, rect.y, rect.width, rect.height),
        element: element,
        groupId: groupId,
        isTextField: candidate.role == 'textbox',
        renderObject: element.renderObject,
        semanticsId: candidate.semanticsId,
        role: candidate.role,
        label: candidate.label,
        enabled: candidate.enabled,
        metadata: {
          'type': candidate.type,
          if (candidate.key != null) 'key': candidate.key,
          if (candidate.selector != null) 'selector': candidate.selector,
        },
      );

      buffer
        ..write('${'  ' * depth}- ${candidate.role}')
        ..write(' "${_escape(candidate.label)}"')
        ..writeln(' [ref=$ref]');

      refs.add({
        'ref': ref,
        'role': candidate.role,
        'label': candidate.label,
        'type': candidate.type,
        if (candidate.key != null) 'key': candidate.key,
        if (candidate.selector != null) 'selector': candidate.selector,
        if (candidate.enabled != null) 'enabled': candidate.enabled,
        'textField': candidate.role == 'textbox',
        if (includeRects)
          'rect': {
            'x': rect.x,
            'y': rect.y,
            'width': rect.width,
            'height': rect.height,
          },
        if (includeProperties) 'properties': candidate.properties,
      });
    });

    return {
      'snapshot': buffer.toString(),
      'groupId': groupId,
      'refs': refs,
      'count': refs.length,
    };
  }

  static void _walkOnstage(
    Element root,
    int depth,
    int? maxDepth,
    void Function(Element element, int depth) visitor,
  ) {
    if (maxDepth != null && depth > maxDepth) return;
    visitor(root, depth);
    root.debugVisitOnstageChildren((child) {
      _walkOnstage(child, depth + 1, maxDepth, visitor);
    });
  }

  static _SnapCandidate? _candidateFor(Element element) {
    final info = InspectExtension.extractWidgetInfo(element);
    if (info == null) return null;

    final rect = _SnapRect.fromJson(info['rect']);
    if (rect == null || rect.width <= 0 || rect.height <= 0) return null;

    final widget = element.widget;
    final type = info['type']?.toString() ?? widget.runtimeType.toString();
    final role = _roleFor(widget, info);
    if (role == null) return null;

    final label = _labelFor(info);
    if (label == null || label.isEmpty) return null;

    return _SnapCandidate(
      type: type,
      role: role,
      label: label,
      rect: rect,
      key: info['key']?.toString(),
      selector: _selectorFor(info, role, label),
      semanticsId: int.tryParse(info['semanticsId']?.toString() ?? ''),
      enabled: _enabledFor(widget),
      properties: Map<String, dynamic>.from(
        info['properties'] as Map? ?? const <String, dynamic>{},
      ),
    );
  }

  static String? _roleFor(Widget widget, Map<String, dynamic> info) {
    final semanticsRole = info['role']?.toString();
    if (semanticsRole == 'button') return 'button';
    if (semanticsRole == 'link') return 'link';
    if (semanticsRole == 'header') return 'heading';
    if (semanticsRole == 'textField') return 'textbox';
    if (semanticsRole == 'checkbox') return 'checkbox';

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

  static String? _labelFor(Map<String, dynamic> info) {
    return info['semanticsLabel']?.toString() ??
        info['text']?.toString() ??
        info['semanticsHint']?.toString() ??
        info['key']?.toString() ??
        info['name']?.toString();
  }

  static bool? _enabledFor(Widget widget) {
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

  static String? _selectorFor(
    Map<String, dynamic> info,
    String role,
    String label,
  ) {
    final key = info['key'];
    if (key is String && key.isNotEmpty) return 'key=$key';
    if (role == 'textbox' && info['semanticsLabel'] is String) {
      return 'semantics=${info['semanticsLabel']}';
    }
    if (label.isNotEmpty) return 'text=$label';
    final type = info['type'];
    if (type is String && type.isNotEmpty) return 'type=$type';
    return null;
  }

  static String _escape(String input) {
    return input.replaceAll(r'\', r'\\').replaceAll('"', r'\"');
  }
}

class _SnapCandidate {
  const _SnapCandidate({
    required this.type,
    required this.role,
    required this.label,
    required this.rect,
    required this.properties,
    this.key,
    this.selector,
    this.semanticsId,
    this.enabled,
  });

  final String type;
  final String role;
  final String label;
  final _SnapRect rect;
  final String? key;
  final String? selector;
  final int? semanticsId;
  final bool? enabled;
  final Map<String, dynamic> properties;
}

class _SnapRect {
  const _SnapRect(this.x, this.y, this.width, this.height);

  final double x;
  final double y;
  final double width;
  final double height;

  static _SnapRect? fromJson(Object? value) {
    if (value is! Map) return null;
    final x = value['x'];
    final y = value['y'];
    final width = value['width'];
    final height = value['height'];
    if (x is! num || y is! num || width is! num || height is! num) {
      return null;
    }
    return _SnapRect(
      x.toDouble(),
      y.toDouble(),
      width.toDouble(),
      height.toDouble(),
    );
  }
}
