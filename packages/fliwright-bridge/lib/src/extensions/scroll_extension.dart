import 'package:flutter/widgets.dart';

import '../bridge.dart';

class ScrollExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.scrollIntoView', _scrollIntoView);
  }

  static Future<Map<String, dynamic>> _scrollIntoView(
    Map<String, String> params,
  ) async {
    final selector = params['selector'] ?? '';
    if (selector.isEmpty) {
      return {'error': 'Missing parameter: selector', 'success': false};
    }

    final alignment = double.tryParse(params['alignment'] ?? '0.5') ?? 0.5;
    final durationMs = int.tryParse(params['duration'] ?? '300') ?? 300;

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
    final targetId = target['id'];
    if (targetId == null) {
      return {
        'error': 'Widget has no element id',
        'success': false,
      };
    }

    // Step 2: Find the Element in the tree by hashCode.
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {
        'error': 'No widget tree available',
        'success': false,
      };
    }

    final targetHashCode = int.tryParse(targetId.toString()) ?? 0;
    Element? targetElement;

    _walkTree(root, (Element element) {
      if (targetElement != null) return;
      if (element.hashCode == targetHashCode) {
        targetElement = element;
      }
    });

    if (targetElement == null) {
      return {
        'error': 'Could not locate element in tree for id: $targetId',
        'success': false,
      };
    }

    // Step 3: Ensure the element has a render object.
    final renderObject = targetElement!.findRenderObject();
    if (renderObject == null) {
      return {
        'error': 'Widget has no render object',
        'success': false,
      };
    }

    // Step 4: Scroll into view.
    try {
      await Scrollable.ensureVisible(
        targetElement!,
        alignment: alignment,
        duration: Duration(milliseconds: durationMs),
        curve: Curves.easeInOut,
      );

      // Get the new vertical offset after scrolling.
      double? newY;
      final newRenderObject = targetElement!.findRenderObject();
      if (newRenderObject is RenderBox && newRenderObject.hasSize) {
        final topLeft = newRenderObject.localToGlobal(Offset.zero);
        newY = topLeft.dy;
      }

      return {
        'success': true,
        'scrolled': true,
        if (newY != null) 'offset': newY,
      };
    } catch (e) {
      return {
        'error': 'Scroll failed: $e',
        'success': false,
      };
    }
  }

  static void _walkTree(Element root, void Function(Element) visitor) {
    visitor(root);
    root.debugVisitOnstageChildren((Element child) {
      _walkTree(child, visitor);
    });
  }
}
