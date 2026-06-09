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
    final mode = params['mode'] ?? 'auto'; // 'auto' | 'boundary' | 'canvas'
    final fullPage = (params['fullPage'] ?? 'false') == 'true';

    // Full-page screenshot: scroll through the content in segments.
    if (fullPage) {
      return await _fullPageScreenshot(root, boundary, pixelRatio);
    }

    // Choose capture strategy based on mode.
    Map<String, dynamic> result;
    if (mode == 'canvas') {
      await _waitForFrame();
      result = await _captureViaCanvas(boundary, pixelRatio);
    } else if (mode == 'boundary') {
      await _waitForFrame();
      result = await _captureBoundary(boundary, pixelRatio);
    } else {
      // 'auto': proactively detect PlatformView → use canvas directly.
      final hasPlatformView =
          _hasPlatformViewInTree(renderObject);
      if (hasPlatformView) {
        await _waitForFrame();
        result = await _captureViaCanvas(boundary, pixelRatio);
      } else {
        try {
          await _waitForFrame();
          result = await _captureBoundary(boundary, pixelRatio);
        } catch (_) {
          // debugNeedsPaint assertion – use canvas-based fallback.
          result = await _captureViaCanvas(boundary, pixelRatio);
        }
      }
    }

    // Optional rect crop.
    final rectJson = params['rect'];
    if (rectJson != null && rectJson.isNotEmpty && result['success'] == true) {
      result = await _cropResult(result, rectJson, pixelRatio);
    }

    return result;
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

  /// Captures a full-page screenshot by scrolling through scrollable content
  /// in viewport-sized segments.
  ///
  /// Returns `{ segments: [base64...], segmentWidth, segmentHeight,
  ///           totalHeight, segmentCount }` so the caller can stitch them.
  static Future<Map<String, dynamic>> _fullPageScreenshot(
    Element root,
    RenderRepaintBoundary boundary,
    double pixelRatio,
  ) async {
    // Find a ScrollPosition in the widget tree to determine total extent.
    final scrollInfo = _findScrollExtent(root);
    final viewportHeight = boundary.size.height;
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
          (scrollController as dynamic).jumpTo(offset.clamp(
            0.0,
            (scrollController as dynamic).position.maxScrollExtent as double,
          ));
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

      // Capture current viewport.
      try {
        final result = await _captureBoundary(boundary, pixelRatio);
        if (result['success'] == true && result['screenshot'] != null) {
          segments.add(result['screenshot'] as String);
        }
      } catch (_) {
        // Try canvas fallback for this segment.
        try {
          final result = await _captureViaCanvas(boundary, pixelRatio);
          if (result['success'] == true && result['screenshot'] != null) {
            segments.add(result['screenshot'] as String);
          }
        } catch (_) {
          // Skip failed segment.
        }
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
      'segmentWidth': boundary.size.width,
      'segmentHeight': viewportHeight,
      'totalHeight': totalHeight,
      'segmentCount': segments.length,
      'pixelRatio': pixelRatio,
    };
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

  /// Detects whether the render tree contains a PlatformView render object
  /// (e.g. WebView, Maps).  When present, `toImage()` is likely to throw
  /// `debugNeedsPaint`, so we proactively use the canvas capture path.
  static bool _hasPlatformViewInTree(RenderObject? root) {
    if (root == null) return false;
    final typeName = root.runtimeType.toString();
    if (typeName.contains('PlatformView')) return true;

    var found = false;
    void visitor(RenderObject child) {
      if (found) return;
      if (child.runtimeType.toString().contains('PlatformView')) {
        found = true;
        return;
      }
      child.visitChildren(visitor);
    }

    root.visitChildren(visitor);
    return found;
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

      final byteData =
          await croppedImage.toByteData(format: ui.ImageByteFormat.png);
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

class _ScrollInfo {
  final dynamic controller;
  final double totalExtent;
  const _ScrollInfo({required this.controller, required this.totalExtent});
}
