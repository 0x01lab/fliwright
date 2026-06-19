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

    final pixelRatio = double.tryParse(params['pixelRatio'] ?? '') ?? 1.0;
    final fullPage = (params['fullPage'] ?? 'false') == 'true';
    final waitForFrame = params['waitForFrame'] == 'true';

    // Full-page screenshot: scroll through the content in segments.
    if (fullPage) {
      return await _fullPageScreenshot(root, pixelRatio);
    }

    if (waitForFrame) await _waitForFrame();

    // Viewport screenshots always capture the composited Flutter view. This
    // avoids accidentally snapshotting a nested repaint boundary from an older
    // route in the stack or a partial subtree.
    var result = await _captureSafely(() => _captureRenderView(pixelRatio));

    // Optional rect crop.
    final rectJson = params['rect'];
    if (rectJson != null && rectJson.isNotEmpty && result['success'] == true) {
      result = await _cropResult(result, rectJson, pixelRatio);
    }

    return result;
  }

  /// Captures the composited root [RenderView] layer.
  ///
  /// This is the preferred "auto" path because it snapshots the full Flutter
  /// scene, including route transitions and overlays, rather than whichever
  /// nested [RenderRepaintBoundary] happens to appear first in the widget tree.
  static Future<Map<String, dynamic>> _captureRenderView(
    double pixelRatio,
  ) async {
    final renderViews = RendererBinding.instance.renderViews;
    if (renderViews.isEmpty) {
      return {'success': false, 'error': 'No render view available'};
    }

    final renderView = renderViews.firstWhere(
      (view) => view.size.width > 0 && view.size.height > 0,
      orElse: () => renderViews.first,
    );
    final layer = renderView.layer;
    final width = renderView.size.width;
    final height = renderView.size.height;
    final viewPixelRatio = renderView.configuration.devicePixelRatio;
    if (layer == null) {
      return {'success': false, 'error': 'Render view has no layer'};
    }
    if (layer is! OffsetLayer) {
      return {
        'success': false,
        'error': 'Render view layer is not an OffsetLayer',
      };
    }
    if (width <= 0 || height <= 0) {
      return {'success': false, 'error': 'Render view has zero size'};
    }
    if (viewPixelRatio <= 0) {
      return {'success': false, 'error': 'Render view has invalid pixel ratio'};
    }

    final bounds = renderView.paintBounds;
    final image = await layer.toImage(
      bounds,
      pixelRatio: pixelRatio / viewPixelRatio,
    );
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
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

  /// Captures a full-page screenshot by scrolling through scrollable content
  /// in viewport-sized segments.
  ///
  /// Returns `{ segments: [base64...], segmentWidth, segmentHeight,
  ///           totalHeight, segmentCount }` so the caller can stitch them.
  static Future<Map<String, dynamic>> _fullPageScreenshot(
    Element root,
    double pixelRatio,
  ) async {
    // Find a ScrollPosition in the widget tree to determine total extent.
    final scrollInfo = _findScrollExtent(root);
    final viewportSize = _currentViewportSize();
    if (viewportSize == null) {
      return {'success': false, 'error': 'No render view available'};
    }
    final viewportHeight = viewportSize.height;
    final totalHeight = scrollInfo.totalExtent > viewportHeight
        ? scrollInfo.totalExtent
        : viewportHeight;

    final segmentCount = (totalHeight / viewportHeight).ceil();
    final segments = <String>[];

    // Capture each segment by scrolling and taking a screenshot.
    final scrollController = scrollInfo.controller;
    for (var i = 0; i < segmentCount; i++) {
      // Scroll to the start of this segment.
      if (scrollController != null) {
        final offset = (i * viewportHeight).toDouble();
        // Use jumpTo via dynamic dispatch (ScrollController is common).
        try {
          (scrollController as dynamic).jumpTo(
            offset.clamp(
              0.0,
              (scrollController as dynamic).position.maxScrollExtent as double,
            ),
          );
        } catch (_) {
          // If jumpTo fails, try animateTo.
          try {
            await (scrollController as dynamic).animateTo(
              offset,
              duration: const Duration(milliseconds: 100),
              curve: Curves.linear,
            );
          } catch (_) {
            // Cannot scroll — just capture what's visible.
          }
        }
      }

      await _waitForFrame();

      final result = await _captureSafely(() => _captureRenderView(pixelRatio));
      if (result['success'] == true && result['screenshot'] != null) {
        segments.add(result['screenshot'] as String);
      }
    }

    // Restore scroll position to top.
    if (scrollController != null) {
      try {
        (scrollController as dynamic).jumpTo(0.0);
      } catch (_) {}
    }

    return {
      'success': true,
      'format': 'png',
      'segments': segments,
      'segmentWidth': viewportSize.width,
      'segmentHeight': viewportHeight,
      'totalHeight': totalHeight,
      'segmentCount': segments.length,
      'pixelRatio': pixelRatio,
    };
  }

  static Future<Map<String, dynamic>> _captureSafely(
    Future<Map<String, dynamic>> Function() capture,
  ) async {
    try {
      return await capture();
    } catch (error) {
      return {
        'success': false,
        'error': 'Render view screenshot failed: $error',
      };
    }
  }

  static Size? _currentViewportSize() {
    final renderViews = RendererBinding.instance.renderViews;
    if (renderViews.isEmpty) return null;
    final renderView = renderViews.firstWhere(
      (view) => view.size.width > 0 && view.size.height > 0,
      orElse: () => renderViews.first,
    );
    if (renderView.size.width <= 0 || renderView.size.height <= 0) {
      return null;
    }
    return renderView.size;
  }

  /// Result of searching the widget tree for scroll extent information.
  static _ScrollInfo _findScrollExtent(Element root) {
    dynamic controller;
    double maxExtent = 0;

    void visitor(Element element) {
      final widget = element.widget;
      // Check for ScrollView / ScrollController via dynamic dispatch.
      try {
        final c = (widget as dynamic).controller;
        if (c != null) {
          controller = c;
          try {
            final me = (c as dynamic).position.maxScrollExtent as double;
            if (me > maxExtent) maxExtent = me;
          } catch (_) {}
        }
      } catch (_) {}

      // Also check the render object for scroll extent.
      final ro = element.findRenderObject();
      if (ro != null) {
        try {
          final me = (ro as dynamic).maxScrollExtent as double;
          if (me > maxExtent) maxExtent = me;
        } catch (_) {}
        try {
          final me = (ro as dynamic).extentAfter as double;
          if (me > maxExtent) maxExtent = me;
        } catch (_) {}
      }

      element.visitChildren(visitor);
    }

    root.visitChildren(visitor);
    return _ScrollInfo(
      controller: controller,
      totalExtent: maxExtent > 0 ? maxExtent : 0,
    );
  }

  /// Crops a screenshot result to the specified logical-pixel rect.
  static Future<Map<String, dynamic>> _cropResult(
    Map<String, dynamic> result,
    String rectJson,
    double pixelRatio,
  ) async {
    try {
      final decoded = jsonDecode(rectJson) as Map<String, dynamic>;
      final cropRect = Rect.fromLTWH(
        (decoded['x'] as num).toDouble(),
        (decoded['y'] as num).toDouble(),
        (decoded['width'] as num).toDouble(),
        (decoded['height'] as num).toDouble(),
      );

      final pngBytes = base64Decode(result['screenshot'] as String);
      final codec = await ui.instantiateImageCodec(pngBytes);
      final frame = await codec.getNextFrame();
      final image = frame.image;

      // Scale crop rect by pixel ratio for pixel-level coordinates.
      final srcRect = Rect.fromLTWH(
        cropRect.left * pixelRatio,
        cropRect.top * pixelRatio,
        cropRect.width * pixelRatio,
        cropRect.height * pixelRatio,
      );

      final recorder = ui.PictureRecorder();
      final canvas = ui.Canvas(recorder, srcRect);
      canvas.drawImage(image, Offset(-srcRect.left, -srcRect.top), ui.Paint());
      final picture = recorder.endRecording();

      final croppedImage = await picture.toImage(
        srcRect.width.toInt(),
        srcRect.height.toInt(),
      );
      image.dispose();

      final byteData = await croppedImage.toByteData(
        format: ui.ImageByteFormat.png,
      );
      croppedImage.dispose();

      if (byteData == null) {
        return result; // Return uncropped on failure.
      }

      return {
        'success': true,
        'format': 'png',
        'screenshot': base64Encode(byteData.buffer.asUint8List()),
        'width': cropRect.width,
        'height': cropRect.height,
        'pixelRatio': pixelRatio,
      };
    } catch (_) {
      // Crop failed — return original uncropped result.
      return result;
    }
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

class _ScrollInfo {
  final dynamic controller;
  final double totalExtent;
  const _ScrollInfo({required this.controller, required this.totalExtent});
}
