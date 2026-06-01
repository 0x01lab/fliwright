import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

class ScreenshotExtension {
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.screenshot', _screenshot);
  }

  static Future<Map<String, dynamic>> _screenshot(
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'success': false, 'error': 'No widget tree available'};
    }

    final renderObject = root.findRenderObject();
    final boundary = _findRepaintBoundary(renderObject);
    if (boundary == null || !boundary.hasSize) {
      return {'success': false, 'error': 'No repaint boundary available'};
    }

    try {
      final pixelRatio = double.tryParse(params['pixelRatio'] ?? '') ?? 1.0;
      final image = await boundary.toImage(pixelRatio: pixelRatio);
      final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      image.dispose();

      if (byteData == null) {
        return {'success': false, 'error': 'Failed to encode screenshot'};
      }

      return {
        'success': true,
        'format': 'png',
        'screenshot': base64Encode(byteData.buffer.asUint8List()),
        'width': boundary.size.width,
        'height': boundary.size.height,
        'pixelRatio': pixelRatio,
      };
    } catch (e) {
      return {'success': false, 'error': 'Screenshot capture failed: $e'};
    }
  }

  static RenderRepaintBoundary? _findRepaintBoundary(RenderObject? root) {
    if (root == null) return null;
    if (root is RenderRepaintBoundary) return root;

    RenderRepaintBoundary? found;
    void visitor(RenderObject child) {
      if (found != null) return;
      found = _findRepaintBoundary(child);
    }

    root.visitChildren(visitor);
    return found;
  }
}
