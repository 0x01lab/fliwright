import 'dart:convert';

import 'package:flutter/widgets.dart';

import '../bridge.dart';
import '../ref_registry.dart';
import 'diagnostics.dart';

class TypeExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.type', _type);
  }

  static Future<Map<String, dynamic>> _type(Map<String, String> params) async {
    final selector = params['selector'] ?? '';
    final ref = params['ref'];
    final precomputedEntry = ref == null ? null : RefRegistry.lookupEntry(ref);
    final precomputedId = params['targetId'];
    final precomputedRectJson = params['targetRect'];
    if (selector.isEmpty &&
        (precomputedId == null || precomputedRectJson == null)) {
      return normalizedFailure(
        code: 'target_not_found',
        message: 'Missing parameter: selector',
        action: 'type',
        recoveryHints: selectorRecoveryHints(),
      );
    }

    final replaceAll = (params['replaceAll'] ?? 'false') == 'true';
    final text = params['text'] ?? '';
    final key = params['key'];
    if (text.isEmpty && key == null && !replaceAll) {
      return normalizedFailure(
        code: 'target_not_found',
        message: 'Missing parameter: text',
        action: 'type',
        target: selectorTarget(selector),
        recoveryHints: selectorRecoveryHints(),
      );
    }
    final charDelayMs = int.tryParse(params['charDelay'] ?? '0') ?? 0;

    // Step 1: Resolve target widget — use pre-computed info when available,
    // otherwise fall back to inspect (backward compatible).
    String? targetId;
    String? targetType;
    Map<String, dynamic>? rect;
    Element? precomputedElement;
    int matchedCount = 0;

    if (precomputedEntry != null) {
      targetId = '${precomputedEntry.element.hashCode}';
      targetType = precomputedEntry.metadata['type']?.toString();
      rect = {
        'x': precomputedEntry.rect.left,
        'y': precomputedEntry.rect.top,
        'width': precomputedEntry.rect.width,
        'height': precomputedEntry.rect.height,
      };
      precomputedElement = precomputedEntry.element;
      matchedCount = 1;
    } else if (precomputedId != null && precomputedRectJson != null) {
      // Fast path: caller already resolved the widget via inspect.
      targetId = precomputedId;
      rect = _parseRectJson(precomputedRectJson);
      matchedCount = 1;
    } else {
      // Slow path: inspect to find the widget.
      final inspectResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.inspect',
        {'selector': selector, 'limit': '20'},
      );

      if (inspectResult.containsKey('error')) {
        return normalizedFailure(
          code: 'target_not_found',
          message: 'Inspect failed: ${inspectResult['error']}',
          action: 'type',
          target: selectorTarget(selector),
          details: {'inspectResult': inspectResult},
          recoveryHints: selectorRecoveryHints(),
        );
      }

      final widgets = inspectResult['widgets'];
      if (widgets is! List || widgets.isEmpty) {
        return normalizedFailure(
          code: 'target_not_found',
          message: 'No widget found for selector: $selector',
          action: 'type',
          target: selectorTarget(selector),
          details: {'selector': selector, 'inspectResult': inspectResult},
          recoveryHints: selectorRecoveryHints(),
        );
      }

      final target = _bestTypeTarget(widgets);
      targetId = target is Map ? target['id'] : null;
      targetType = target is Map ? target['type'] : null;
      rect = target['rect'] as Map<String, dynamic>?;
      matchedCount = widgets.length;
    }

    if (rect == null) {
      return normalizedFailure(
        code: 'actionability_zero_rect',
        message:
            'Widget has no render geometry (no rect): selector=$selector targetType=$targetType targetId=$targetId',
        action: 'type',
        target: selectorTarget(
          selector,
          targetId: targetId,
          targetType: targetType,
        ),
        details: {'selector': selector, 'matchedCount': matchedCount},
        recoveryHints: actionabilityRecoveryHints(),
      );
    }

    // Step 2: Click to focus the widget.
    final x = rect['x'];
    final y = rect['y'];
    final width = rect['width'];
    final height = rect['height'];

    if (x == null || y == null || width == null || height == null) {
      return normalizedFailure(
        code: 'actionability_zero_rect',
        message:
            'Widget rect is incomplete: selector=$selector targetType=$targetType targetId=$targetId',
        action: 'type',
        target: selectorTarget(
          selector,
          targetId: targetId,
          targetType: targetType,
          rect: rect,
        ),
        details: {'selector': selector, 'matchedCount': matchedCount},
        recoveryHints: actionabilityRecoveryHints(),
      );
    }

    // Click the center of the widget.
    final centerX = (x as num) + (width as num) / 2;
    final centerY = (y as num) + (height as num) / 2;

    final clickResult = await FliwrightBridge.registry.invoke(
      'ext.fliwright.click',
      {'x': centerX.toString(), 'y': centerY.toString()},
    );

    if (clickResult.containsKey('error')) {
      return normalizedFailure(
        code: clickResult['code']?.toString() ?? 'actionability_failed',
        message: 'Click failed: ${clickResult['error']}',
        action: 'type',
        target: selectorTarget(
          selector,
          targetId: targetId,
          targetType: targetType,
          rect: rect,
        ),
        details: {'click': clickResult},
        recoveryHints: actionabilityRecoveryHints(),
      );
    }

    // Step 3: Find the target EditableText.
    // Always wait for focus to settle — focus is async (microtask) in Flutter
    // and without a delay the focus check races with the click.
    final canResolveByPrecomputedTarget = targetId != null && key != null;
    if (!canResolveByPrecomputedTarget) {
      final settleDelay = charDelayMs > 0 ? charDelayMs : 50;
      await Future<void>.delayed(Duration(milliseconds: settleDelay));
    }

    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return normalizedFailure(
        code: 'target_not_found',
        message: 'No widget tree available',
        action: 'type',
        target: selectorTarget(
          selector,
          targetId: targetId,
          targetType: targetType,
          rect: rect,
        ),
        recoveryHints: selectorRecoveryHints(),
      );
    }

    EditableText? focusedEditable;
    String? focusedEditableId;
    Element? editableElement; // Track the element for _notifyFormField.

    // Strategy B (PROMOTED): if we have targetId, locate the element directly
    // and search its subtree for EditableText. This is O(depth) instead of
    // O(N) and works even when focus is intercepted (e.g. FormBuilder).
    if (targetId != null || precomputedElement != null) {
      Element? targetEl = precomputedElement;
      if (targetEl == null && targetId != null) {
        _walkTree(root, (Element element) {
          if (targetEl != null) return;
          if ('${element.hashCode}' == targetId) {
            targetEl = element;
          }
        });
      }
      if (targetEl != null) {
        // The target element itself might be the EditableText.
        if (targetEl!.widget is EditableText) {
          focusedEditable = targetEl!.widget as EditableText;
          focusedEditableId = '${targetEl!.hashCode}';
          editableElement = targetEl;
        } else {
          // Search subtree for an EditableText descendant.
          _walkTree(targetEl!, (Element element) {
            if (focusedEditable != null) return;
            if (element.widget is EditableText) {
              focusedEditable = element.widget as EditableText;
              focusedEditableId = '${element.hashCode}';
              editableElement = element;
            }
          });
        }
      }

      // If Strategy B found nothing by targetId, save targetEl for Strategy C.
      if (focusedEditable == null && targetEl != null) {
        // Keep targetEl reference for Strategy C below.
        // (Reuse via the targetEl local which is still in scope.)
      }

      // Strategy C (moved up): if targetId lookup found the element but no
      // EditableText descendant, walk ancestors to find the nearest
      // EditableText in the same local container.
      if (focusedEditable == null && targetEl != null) {
        final targetCenter = Offset(centerX.toDouble(), centerY.toDouble());
        targetEl!.visitAncestorElements((ancestor) {
          if (focusedEditable != null) return false;
          if (ancestor.widget.runtimeType.toString() == 'Scaffold' ||
              ancestor.widget.runtimeType.toString() == 'MaterialApp') {
            return false;
          }

          Element? nearestEditableEl;
          double nearestDistance = double.infinity;
          _walkTree(ancestor, (Element element) {
            if (element.widget is! EditableText) return;

            final renderObject = element.findRenderObject();
            if (renderObject is! RenderBox || !renderObject.hasSize) return;

            final topLeft = renderObject.localToGlobal(Offset.zero);
            final ancestorRect = topLeft & renderObject.size;
            final center = ancestorRect.center;
            final distance = (center - targetCenter).distance;
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestEditableEl = element;
            }
          });

          if (nearestEditableEl != null) {
            focusedEditable = nearestEditableEl!.widget as EditableText;
            focusedEditableId = '${nearestEditableEl!.hashCode}';
            editableElement = nearestEditableEl;
            return false;
          }
          return true;
        });
      }
    }

    // Strategy A: look for the focused EditableText (works for standard
    // TextField / TextFormField / FormBuilderTextField).
    if (focusedEditable == null) {
      _walkTree(root, (Element element) {
        if (focusedEditable != null) return;
        final widget = element.widget;
        if (widget is EditableText && widget.focusNode.hasFocus) {
          focusedEditable = widget;
          focusedEditableId = '${element.hashCode}';
          editableElement = element;
        }
      });
    }

    // Strategy D: hint/label selectors often match a Text/RichText rendered
    // inside the input decoration, not the editable itself. In that case,
    // locate the EditableText whose render bounds contain the click point.
    if (focusedEditable == null) {
      _walkTree(root, (Element element) {
        if (editableElement != null) return;
        if (element.widget is! EditableText) return;

        final renderObject = element.findRenderObject();
        if (renderObject is! RenderBox || !renderObject.hasSize) return;

        final topLeft = renderObject.localToGlobal(Offset.zero);
        final elementRect = topLeft & renderObject.size;
        if (elementRect
            .inflate(12)
            .contains(Offset(centerX.toDouble(), centerY.toDouble()))) {
          editableElement = element;
          focusedEditable = element.widget as EditableText;
          focusedEditableId = '${element.hashCode}';
        }
      });
    }

    if (focusedEditable == null) {
      return normalizedFailure(
        code: 'actionability_failed',
        message:
            'No EditableText found after click: selector=$selector targetType=$targetType targetId=$targetId matchedCount=$matchedCount',
        action: 'type',
        target: selectorTarget(
          selector,
          targetId: targetId,
          targetType: targetType,
          rect: rect,
        ),
        details: {
          'selector': selector,
          'matchedCount': matchedCount,
          'targetId': targetId,
          'targetType': targetType,
          'targetRect': rect,
          'click': {'x': centerX, 'y': centerY},
        },
        recoveryHints: actionabilityRecoveryHints(),
      );
    }

    final controller = focusedEditable!.controller;
    final currentText = controller.text;
    var notifiedEditableChanged = false;
    String newText;

    if (key != null && key.isNotEmpty) {
      try {
        newText = _applyKey(controller, key);
        notifiedEditableChanged = _notifyEditableTextChanged(
          focusedEditable!,
          currentText,
          newText,
        );
      } catch (error) {
        return normalizedFailure(
          code: 'actionability_failed',
          message: error.toString(),
          action: 'type',
          target: selectorTarget(
            selector,
            targetId: targetId,
            targetType: targetType,
            rect: rect,
          ),
          recoveryHints: actionabilityRecoveryHints(),
        );
      }
    } else if (replaceAll) {
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
      notifiedEditableChanged = _notifyEditableTextChanged(
        focusedEditable!,
        currentText,
        newText,
      );
    } else {
      // Type character-by-character to simulate realistic input.
      // Each step uses controller.value (single notification per char)
      // so that onChanged fires exactly once per keystroke — the same
      // sequence a real user would produce.
      final buffer = StringBuffer(currentText);
      var previousText = currentText;
      for (final rune in text.runes) {
        final char = String.fromCharCode(rune);
        buffer.write(char);
        final nextText = buffer.toString();
        controller.value = TextEditingValue(
          text: nextText,
          selection: TextSelection.collapsed(offset: buffer.length),
          composing: TextRange.empty,
        );
        notifiedEditableChanged =
            _notifyEditableTextChanged(
              focusedEditable!,
              previousText,
              nextText,
            ) ||
            notifiedEditableChanged;
        previousText = nextText;
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
    if (editableElement != null && !notifiedEditableChanged) {
      _notifyFormField(editableElement!, newText);
    }

    return normalizedSuccess(
      action: replaceAll ? 'fill' : 'type',
      target: selectorTarget(
        selector,
        targetId: targetId,
        targetType: targetType,
        rect: rect,
      ),
      details: {
        'selector': selector,
        'matchedCount': matchedCount,
        'targetId': targetId,
        'targetType': targetType,
        'editableId': focusedEditableId,
        'replaceAll': replaceAll,
        if (key != null) 'key': key,
      },
      extra: {'currentText': newText},
    );
  }

  /// Direct controller edits update the visual text and controller listeners,
  /// but they do not invoke EditableText.onChanged. Fire that callback
  /// explicitly so automation follows the same contract as user input.
  static bool _notifyEditableTextChanged(
    EditableText editable,
    String previousText,
    String nextText,
  ) {
    if (previousText == nextText || editable.onChanged == null) return false;
    editable.onChanged!(nextText);
    return true;
  }

  /// Walk up from [editableElement] to find a [FormField] ancestor
  /// and call [FormFieldState.didChange] so that form libraries
  /// (flutter_form_builder, etc.) correctly sync their internal state.
  ///
  /// Receives the [editableElement] directly instead of walking the
  /// entire tree to rediscover it.
  static void _notifyFormField(Element editableElement, String value) {
    // Walk ancestors looking for a FormFieldState.
    editableElement.visitAncestorElements((ancestor) {
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

  static Map<String, dynamic>? _parseRectJson(String json) {
    try {
      final decoded = jsonDecode(json);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {}
    return null;
  }

  static dynamic _bestTypeTarget(List<dynamic> widgets) {
    for (final widget in widgets) {
      if (widget is Map && widget['type'] == 'EditableText') {
        return widget;
      }
    }
    for (final widget in widgets) {
      if (widget is Map && widget['rect'] is Map<String, dynamic>) {
        return widget;
      }
    }
    return widgets.first;
  }

  static String _applyKey(TextEditingController controller, String key) {
    final value = controller.value;
    final text = value.text;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: text.length);
    final start = selection.start < selection.end
        ? selection.start
        : selection.end;
    final end = selection.start < selection.end
        ? selection.end
        : selection.start;

    TextEditingValue nextValue(String nextText, int offset) {
      return TextEditingValue(
        text: nextText,
        selection: TextSelection.collapsed(
          offset: offset.clamp(0, nextText.length),
        ),
        composing: TextRange.empty,
      );
    }

    switch (key) {
      case 'Backspace':
        if (start != end) {
          final next = text.replaceRange(start, end, '');
          controller.value = nextValue(next, start);
          return next;
        }
        if (start <= 0) return text;
        final next = text.replaceRange(start - 1, start, '');
        controller.value = nextValue(next, start - 1);
        return next;
      case 'Delete':
        if (start != end) {
          final next = text.replaceRange(start, end, '');
          controller.value = nextValue(next, start);
          return next;
        }
        if (start >= text.length) return text;
        final next = text.replaceRange(start, start + 1, '');
        controller.value = nextValue(next, start);
        return next;
      case 'Enter':
        return _insertText(controller, '\n');
      case 'Tab':
        return _insertText(controller, '\t');
      case 'Space':
        return _insertText(controller, ' ');
      case 'ArrowLeft':
        controller.value = nextValue(text, start <= 0 ? 0 : start - 1);
        return text;
      case 'ArrowRight':
        controller.value = nextValue(
          text,
          end >= text.length ? text.length : end + 1,
        );
        return text;
      default:
        if (key.length == 1) return _insertText(controller, key);
        throw ArgumentError('Unsupported key: $key');
    }
  }

  static String _insertText(
    TextEditingController controller,
    String insertion,
  ) {
    final value = controller.value;
    final text = value.text;
    final selection = value.selection.isValid
        ? value.selection
        : TextSelection.collapsed(offset: text.length);
    final start = selection.start < selection.end
        ? selection.start
        : selection.end;
    final end = selection.start < selection.end
        ? selection.end
        : selection.start;
    final next = text.replaceRange(start, end, insertion);
    controller.value = TextEditingValue(
      text: next,
      selection: TextSelection.collapsed(offset: start + insertion.length),
      composing: TextRange.empty,
    );
    return next;
  }
}
