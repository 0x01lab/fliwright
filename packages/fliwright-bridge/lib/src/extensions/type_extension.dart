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
      {'selector': selector, 'limit': '1'},
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
        'debug': {
          'selector': selector,
          'inspectResult': inspectResult,
        },
      };
    }

    final target = widgets.first;
    final targetId = target is Map ? target['id'] : null;
    final targetType = target is Map ? target['type'] : null;
    final rect = target['rect'];
    if (rect is! Map<String, dynamic>) {
      return {
        'error':
            'Widget has no render geometry (no rect): selector=$selector targetType=$targetType targetId=$targetId',
        'success': false,
        'debug': {
          'selector': selector,
          'matchedCount': widgets.length,
          'target': target,
        },
      };
    }

    // Step 2: Click to focus the widget.
    final x = rect['x'];
    final y = rect['y'];
    final width = rect['width'];
    final height = rect['height'];

    if (x == null || y == null || width == null || height == null) {
      return {
        'error':
            'Widget rect is incomplete: selector=$selector targetType=$targetType targetId=$targetId',
        'success': false,
        'debug': {
          'selector': selector,
          'matchedCount': widgets.length,
          'target': target,
        },
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

    // Step 3: Find the target EditableText.
    // Always wait for focus to settle — focus is async (microtask) in Flutter
    // and without a delay the focus check races with the click.
    final settleDelay = charDelayMs > 0 ? charDelayMs : 50;
    await Future<void>.delayed(Duration(milliseconds: settleDelay));

    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {
        'error': 'No widget tree available',
        'success': false,
      };
    }

    // Strategy A: look for the focused EditableText (works for standard
    // TextField / TextFormField / FormBuilderTextField).
    EditableText? focusedEditable;
    String? focusedEditableId;
    _walkTree(root, (Element element) {
      if (focusedEditable != null) return;
      final widget = element.widget;
      if (widget is EditableText && widget.focusNode.hasFocus) {
        focusedEditable = widget;
        focusedEditableId = '${element.hashCode}';
      }
    });

    // Strategy B: if no focused widget was found (e.g. FormBuilder may
    // intercept focus), fall back to locating the EditableText that is a
    // descendant of the inspected element.
    Element? targetElement;
    if (focusedEditable == null) {
      if (targetId is String) {
        _walkTree(root, (Element element) {
          if (targetElement != null) return;
          if ('${element.hashCode}' == targetId) {
            targetElement = element;
          }
        });
        if (targetElement != null) {
          _walkTree(targetElement!, (Element element) {
            if (focusedEditable != null) return;
            if (element.widget is EditableText) {
              focusedEditable = element.widget as EditableText;
              focusedEditableId = '${element.hashCode}';
            }
          });
        }
      }
    }

    // Strategy C: label selectors may match a sibling Text near a
    // FormBuilderTextField/TextField. Walk closest ancestors first and pick
    // the nearest EditableText inside the same local container.
    if (focusedEditable == null && targetElement != null) {
      final targetCenter = Offset(centerX.toDouble(), centerY.toDouble());
      targetElement!.visitAncestorElements((ancestor) {
        if (focusedEditable != null) return false;
        if (ancestor.widget.runtimeType.toString() == 'Scaffold' ||
            ancestor.widget.runtimeType.toString() == 'MaterialApp') {
          return false;
        }

        Element? nearestEditableElement;
        double nearestDistance = double.infinity;
        _walkTree(ancestor, (Element element) {
          if (element.widget is! EditableText) return;

          final renderObject = element.findRenderObject();
          if (renderObject is! RenderBox || !renderObject.hasSize) return;

          final topLeft = renderObject.localToGlobal(Offset.zero);
          final rect = topLeft & renderObject.size;
          final center = rect.center;
          final distance = (center - targetCenter).distance;
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestEditableElement = element;
          }
        });

        if (nearestEditableElement != null) {
          focusedEditable = nearestEditableElement!.widget as EditableText;
          focusedEditableId = '${nearestEditableElement!.hashCode}';
          return false;
        }
        return true;
      });
    }

    // Strategy D: hint/label selectors often match a Text/RichText rendered
    // inside the input decoration, not the editable itself. In that case,
    // locate the EditableText whose render bounds contain the click point.
    if (focusedEditable == null) {
      Element? pointEditableElement;
      _walkTree(root, (Element element) {
        if (pointEditableElement != null) return;
        if (element.widget is! EditableText) return;

        final renderObject = element.findRenderObject();
        if (renderObject is! RenderBox || !renderObject.hasSize) return;

        final topLeft = renderObject.localToGlobal(Offset.zero);
        final rect = topLeft & renderObject.size;
        if (rect
            .inflate(12)
            .contains(Offset(centerX.toDouble(), centerY.toDouble()))) {
          pointEditableElement = element;
          focusedEditable = element.widget as EditableText;
          focusedEditableId = '${element.hashCode}';
        }
      });
    }

    if (focusedEditable == null) {
      return {
        'error':
            'No EditableText found after click: selector=$selector targetType=$targetType targetId=$targetId matchedCount=${widgets.length}',
        'success': false,
        'debug': {
          'selector': selector,
          'matchedCount': widgets.length,
          'targetId': targetId,
          'targetType': targetType,
          'targetRect': rect,
          'click': {'x': centerX, 'y': centerY},
        },
      };
    }

    final controller = focusedEditable!.controller;
    final currentText = controller.text;
    String newText;

    if (replaceAll) {
      newText = text;
      // Use controller.value instead of controller.text to set everything
      // in a single notification.  controller.text creates a value with
      // selection offset -1 and then a second update is needed for the
      // cursor — two notifications can confuse FormField / FormBuilder.
      controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: newText.length),
        composing: TextRange.empty,
      );
    } else {
      // Type character-by-character to simulate realistic input.
      // Each step uses controller.value (single notification per char)
      // so that onChanged fires exactly once per keystroke — the same
      // sequence a real user would produce.
      final buffer = StringBuffer(currentText);
      for (final rune in text.runes) {
        final char = String.fromCharCode(rune);
        buffer.write(char);
        controller.value = TextEditingValue(
          text: buffer.toString(),
          selection: TextSelection.collapsed(offset: buffer.length),
          composing: TextRange.empty,
        );
        if (charDelayMs > 0) {
          await Future<void>.delayed(Duration(milliseconds: charDelayMs));
        }
      }
      newText = buffer.toString();
    }

    // Step 4: Notify the enclosing FormField (if any) that the value
    // changed.  This is critical for flutter_form_builder and other
    // form libraries that track state via FormField.didChange rather
    // than only through the TextEditingController.
    _notifyFormField(root, focusedEditable!, newText);

    return {
      'success': true,
      'currentText': newText,
      'debug': {
        'selector': selector,
        'matchedCount': widgets.length,
        'targetId': targetId,
        'targetType': targetType,
        'editableId': focusedEditableId,
        'replaceAll': replaceAll,
      },
    };
  }

  /// Walk up from the [editableElement] to find a [FormField] ancestor
  /// and call [FormFieldState.didChange] so that form libraries
  /// (flutter_form_builder, etc.) correctly sync their internal state.
  static void _notifyFormField(
    Element root,
    EditableText editableWidget,
    String value,
  ) {
    // Find the Element that hosts the EditableText widget.
    Element? editableElement;
    _walkTree(root, (Element element) {
      if (editableElement != null) return;
      if (element.widget == editableWidget) {
        editableElement = element;
      }
    });
    if (editableElement == null) return;

    // Walk ancestors looking for a FormFieldState.
    editableElement!.visitAncestorElements((ancestor) {
      // The ancestor's State might be a FormFieldState subclass.
      final state = ancestor is StatefulElement ? ancestor.state : null;
      if (state != null) {
        // Use a dynamic call because FormFieldState is generic and we
        // cannot cast to FormFieldState<String> at compile time.
        try {
          (state as dynamic).didChange(value);
        } catch (_) {
          // Not a FormFieldState — keep climbing.
          return true;
        }
        return false;
      }
      // Stop at logical boundaries.
      if (ancestor.widget.runtimeType.toString() == 'Scaffold') {
        return false;
      }
      return true;
    });
  }

  static void _walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, visitor);
    });
  }
}
