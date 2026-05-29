import 'package:flutter/widgets.dart';

import '../bridge.dart';

class TypeExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.type', _type);
  }

  static Future<Map<String, dynamic>> _type(Map<String, String> params) async {
    final selector = params['selector'] ?? '';
    if (selector.isEmpty) {
      return {'error': 'Missing parameter: selector', 'success': false};
    }

    final text = params['text'] ?? '';
    if (text.isEmpty) {
      return {'error': 'Missing parameter: text', 'success': false};
    }

    final replaceAll = (params['replaceAll'] ?? 'false') == 'true';
    final charDelayMs = int.tryParse(params['charDelay'] ?? '0') ?? 0;

    // Step 1: Inspect to find the widget.
    final inspectResult = await FliwrightBridge.registry.invoke(
      'ext.fliwright.inspect',
      {'selector': selector},
    );

    if (inspectResult.containsKey('error')) {
      return {
        'error': 'Inspect failed: ${inspectResult['error']}',
        'success': false,
      };
    }

    final widgets = inspectResult['widgets'];
    if (widgets is! List || widgets.isEmpty) {
      return {
        'error': 'No widget found for selector: $selector',
        'success': false,
      };
    }

    final target = widgets.first;
    final rect = target['rect'];
    if (rect is! Map<String, dynamic>) {
      return {
        'error': 'Widget has no render geometry (no rect)',
        'success': false,
      };
    }

    // Step 2: Click to focus the widget.
    final x = rect['x'];
    final y = rect['y'];
    final width = rect['width'];
    final height = rect['height'];

    if (x == null || y == null || width == null || height == null) {
      return {
        'error': 'Widget rect is incomplete',
        'success': false,
      };
    }

    // Click the center of the widget.
    final centerX = (x as num) + (width as num) / 2;
    final centerY = (y as num) + (height as num) / 2;

    final clickResult = await FliwrightBridge.registry.invoke(
      'ext.fliwright.click',
      {
        'x': centerX.toString(),
        'y': centerY.toString(),
      },
    );

    if (clickResult.containsKey('error')) {
      return {
        'error': 'Click failed: ${clickResult['error']}',
        'success': false,
      };
    }

    // Step 3: Find the focused EditableText.
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {
        'error': 'No widget tree available',
        'success': false,
      };
    }

    // Allow focus to settle.
    if (charDelayMs > 0) {
      await Future<void>.delayed(Duration(milliseconds: charDelayMs));
    }

    EditableText? focusedEditable;
    _walkTree(root, (Element element) {
      if (focusedEditable != null) return;
      final widget = element.widget;
      if (widget is EditableText && widget.focusNode.hasFocus) {
        focusedEditable = widget;
      }
    });

    if (focusedEditable == null) {
      return {
        'error': 'No focused EditableText found after click',
        'success': false,
      };
    }

    final controller = focusedEditable!.controller;
    final currentText = controller.text;
    String newText;

    if (replaceAll) {
      newText = text;
    } else {
      // Type character by character to simulate realistic input.
      final buffer = StringBuffer(currentText);
      for (final rune in text.runes) {
        final char = String.fromCharCode(rune);
        buffer.write(char);
        controller.text = buffer.toString();
        controller.selection = TextSelection.collapsed(
          offset: buffer.length,
        );
        if (charDelayMs > 0) {
          await Future<void>.delayed(Duration(milliseconds: charDelayMs));
        }
      }
      newText = buffer.toString();
    }

    if (replaceAll) {
      controller.text = newText;
      controller.selection = TextSelection.collapsed(
        offset: newText.length,
      );
    }

    return {
      'success': true,
      'currentText': newText,
    };
  }

  static void _walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, visitor);
    });
  }
}
