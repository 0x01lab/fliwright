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

    final pixelRatio =
        double.tryParse(params['pixelRatio'] ?? '') ?? 1.0;

    // Try capturing with frame settling first; if that fails due to
    // debugNeedsPaint (common with WebView/PlatformView), fall back to
    // rendering into an offscreen canvas which bypasses the assertion.
    try {
      await _waitForFrame();
      return await _captureBoundary(boundary, pixelRatio);
    } catch (_) {
      // debugNeedsPaint assertion – use canvas-based fallback.
      return await _captureViaCanvas(boundary, pixelRatio);
    }
  }

  /// Direct capture via RepaintBoundary.toImage.
  static Future<Map<String, dynamic>> _captureBoundary(
    RenderRepaintBoundary boundary,
    double pixelRatio,
  ) async {
    final image = await boundary.toImage(pixelRatio: pixelRatio);
    final byteData =
        await image.toByteData(format: ui.ImageByteFormat.png);
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
  }

  /// Fallback: paint the render object into an offscreen [OffsetLayer]
  /// and convert to PNG.  This avoids the `!debugNeedsPaint` assertion
  /// because we never call `toImage()` on the live boundary.
  static Future<Map<String, dynamic>> _captureViaCanvas(
    RenderRepaintBoundary boundary,
    double pixelRatio,
  ) async {
    final width = boundary.size.width;
    final height = boundary.size.height;
    if (width <= 0 || height <= 0) {
      return {'success': false, 'error': 'Boundary has zero size'};
    }

    final bounds =
        Rect.fromLTWH(0, 0, width, height);

    // Paint into a fresh OffsetLayer, then rasterise that layer to PNG.
    // OffsetLayer.toImage() does NOT assert debugNeedsPaint.
    final offsetLayer = OffsetLayer();
    final paintContext = PaintingContext(offsetLayer, bounds);
    boundary.paint(paintContext, Offset.zero);
    paintContext.stopRecordingIfNeeded();

    final image = await offsetLayer.toImage(bounds, pixelRatio: pixelRatio);
    final byteData =
        await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();

    if (byteData == null) {
      return {'success': false, 'error': 'Failed to encode screenshot'};
    }

    return {
      'success': true,
      'format': 'png',
      'screenshot': base64Encode(byteData.buffer.asUint8List()),
      'width': width,
      'height': height,
      'pixelRatio': pixelRatio,
    };
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

  /// Wait for Flutter to finish rendering the current frame.
  /// Pumps multiple frames so that ongoing repaint requests (e.g. WebView)
  /// converge before we attempt capture.
  static Future<void> _waitForFrame() async {
    final binding = WidgetsBinding.instance;
    for (var i = 0; i < 5; i++) {
      binding.addPostFrameCallback((_) {});
      binding.handleDrawFrame();
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
  }
}
