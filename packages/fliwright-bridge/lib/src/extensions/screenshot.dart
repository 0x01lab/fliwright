import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../bridge.dart';

class ScreenshotExtension {
  static void register(ExtensionRegistry registry) {
    registry.register(
      'ext.fliwright.screenshot',
      (params) => _screenshot(registry, params),
    );
  }

  static Future<Map<String, dynamic>> _screenshot(
    ExtensionRegistry registry,
    Map<String, String> params,
  ) async {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) {
      return {'success': false, 'error': 'No widget tree available'};
    }

    final pixelRatio = double.tryParse(params['pixelRatio'] ?? '') ?? 1.0;
    final fullPage = (params['fullPage'] ?? 'false') == 'true';
    final waitForFrame = params['waitForFrame'] != 'false';
    final waitForAnimations = params['waitForAnimations'] == 'true';

    if (waitForAnimations) {
      await registry.invoke('ext.fliwright.settle', {
        'timeout': params['settleTimeout'] ?? '500',
      });
    }

    if (!pixelRatio.isFinite || pixelRatio <= 0) {
      return {
        'success': false,
        'error': 'pixelRatio must be finite and positive'
      };
    }
    if (fullPage && params.containsKey('rect')) {
      return {
        'success': false,
        'error': 'fullPage cannot be combined with rect'
      };
    }
    if (waitForFrame) await _waitForFrame();
    if (fullPage) {
      return _captureSafely(
          () => _fullPageScreenshot(registry, root, pixelRatio, params));
    }

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
    final image = await _captureRenderViewImage(pixelRatio);
    try {
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      if (bytes == null) throw StateError('Failed to encode screenshot');
      final size = _currentViewportSize()!;
      return {
        'success': true,
        'format': 'png',
        'screenshot': base64Encode(bytes.buffer.asUint8List()),
        'width': size.width,
        'height': size.height,
        'pixelRatio': pixelRatio,
      };
    } finally {
      image.dispose();
    }
  }

  static Future<ui.Image> _captureRenderViewImage(double pixelRatio) async {
    final renderViews = RendererBinding.instance.renderViews;
    if (renderViews.isEmpty) {
      throw StateError('No render view available');
    }

    final renderView = renderViews.firstWhere(
      (view) => view.size.width > 0 && view.size.height > 0,
      orElse: () => renderViews.first,
    );
    // Flutter exposes the composited root only through this protected getter;
    // debugLayer is unavailable in profile/release and nested boundaries omit routes.
    // ignore: invalid_use_of_protected_member
    final layer = renderView.layer;
    final width = renderView.size.width;
    final height = renderView.size.height;
    final viewPixelRatio = renderView.configuration.devicePixelRatio;
    if (layer == null) {
      throw StateError('Render view has no layer');
    }
    if (layer is! OffsetLayer) {
      throw StateError('Render view layer is not an OffsetLayer');
    }
    if (width <= 0 || height <= 0) {
      throw StateError('Render view has zero size');
    }
    if (viewPixelRatio <= 0) {
      throw StateError('Render view has invalid pixel ratio');
    }

    final physicalWidth = (width * viewPixelRatio).ceil();
    final physicalHeight = (height * viewPixelRatio).ceil();
    final outputWidth = (width * pixelRatio).ceil();
    final outputHeight = (height * pixelRatio).ceil();
    final scene = layer.buildScene(ui.SceneBuilder());
    late final ui.Image physicalImage;
    try {
      physicalImage = await scene.toImage(physicalWidth, physicalHeight);
    } finally {
      scene.dispose();
    }
    if (pixelRatio == viewPixelRatio) return physicalImage;
    try {
      return await _resizeImage(physicalImage, outputWidth, outputHeight);
    } finally {
      physicalImage.dispose();
    }
  }

  static Future<ui.Image> _resizeImage(
    ui.Image source,
    int width,
    int height,
  ) async {
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder);
    canvas.drawImageRect(
      source,
      Rect.fromLTWH(0, 0, source.width.toDouble(), source.height.toDouble()),
      Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
      ui.Paint(),
    );
    final picture = recorder.endRecording();
    try {
      return await picture.toImage(width, height);
    } finally {
      picture.dispose();
    }
  }

  /// Paint each newly exposed strip once. Stitching belongs in the bridge so
  /// every caller receives the same PNG without a host-side image dependency.
  static Future<Map<String, dynamic>> _fullPageScreenshot(
    ExtensionRegistry registry,
    Element root,
    double pixelRatio,
    Map<String, String> params,
  ) async {
    final maxHeight = double.tryParse(params['maxHeight'] ?? '20000');
    if (maxHeight == null || !maxHeight.isFinite || maxHeight <= 0) {
      throw ArgumentError('maxHeight must be finite and positive');
    }
    Element searchRoot = root;
    final selector = params['scrollable'];
    if (selector != null) {
      final resolved = await registry.invoke('ext.fliwright.resolve', {
        'selector': selector,
        'strict': 'true',
        'limit': '2',
        'visible': 'hitTestable',
      });
      final matches = resolved['matches'] as List?;
      if (resolved['error'] != null || matches == null || matches.length != 1) {
        throw StateError(
            'scrollable must resolve to one visible scroll view: ${resolved['error'] ?? selector}');
      }
      final id = matches.single['id'].toString();
      Element? target;
      void locate(Element element) {
        if (element.hashCode.toString() == id) target = element;
        element.debugVisitOnstageChildren(locate);
      }

      locate(root);
      if (target == null)
        throw StateError('Scrollable target is no longer mounted');
      searchRoot = target!;
    }
    final viewSize = _currentViewportSize();
    if (viewSize == null) throw StateError('No render view available');
    final viewRect = Offset.zero & viewSize;
    final candidates = <ScrollableState>[];
    void visit(Element element) {
      if (element is StatefulElement && element.state is ScrollableState) {
        final state = element.state as ScrollableState;
        final box = state.context.findRenderObject();
        if (box is RenderBox &&
            box.hasSize &&
            (box.localToGlobal(Offset.zero) & box.size).overlaps(viewRect)) {
          candidates.add(state);
        }
      }
      element.debugVisitOnstageChildren(visit);
    }

    visit(searchRoot);
    if (candidates.isEmpty) {
      if (selector != null)
        throw StateError('No visible scroll view in $selector');
      if (viewSize.height > maxHeight)
        throw StateError('Full-page screenshot exceeds maxHeight');
      _checkImageSize(viewSize.width, viewSize.height, pixelRatio);
      return _captureRenderView(pixelRatio);
    }
    if (candidates.length != 1) {
      throw StateError(
          'Multiple or nested scroll views: specify scrollable to select one');
    }
    final state = candidates.single;
    final position = state.position;
    if (position.axisDirection != AxisDirection.down) {
      throw StateError(
          'Full-page screenshots require a non-reversed vertical scroll view');
    }
    final box = state.context.findRenderObject()! as RenderBox;
    void checkHeaders(RenderObject object) {
      if (object is RenderSliverPinnedPersistentHeader ||
          object is RenderSliverFloatingPersistentHeader) {
        throw StateError(
            'Sticky or floating headers are unsupported in full-page screenshots');
      }
      object.visitChildren(checkHeaders);
    }

    checkHeaders(box);
    final viewport = _findViewport(box);
    if (viewport == null || !viewport.isRepaintBoundary) {
      throw StateError('Scroll viewport has no isolated capture layer');
    }
    final rect = box.localToGlobal(Offset.zero) & box.size;
    if (!viewRect.contains(rect.topLeft) ||
        rect.right > viewRect.right ||
        rect.bottom > viewRect.bottom ||
        rect.width <= 0 ||
        rect.height <= 0) {
      throw StateError('The entire scroll viewport must be visible');
    }
    final originalOffset = position.pixels;
    final recorder = ui.PictureRecorder();
    final canvas = ui.Canvas(recorder)..scale(pixelRatio);
    var covered = 0.0;
    var count = 0;
    try {
      position.jumpTo(position.minScrollExtent);
      while (true) {
        await _waitForFrame();
        if (!state.mounted || !position.hasContentDimensions) {
          throw StateError('Scroll view changed during screenshot');
        }
        final currentBox = state.context.findRenderObject();
        if (currentBox != box ||
            box.size != rect.size ||
            viewport.size != rect.size ||
            box.localToGlobal(Offset.zero) != rect.topLeft ||
            (position.viewportDimension - rect.height).abs() > 0.01) {
          throw StateError(
              'Scroll viewport geometry changed or is unsupported');
        }
        final totalHeight =
            position.maxScrollExtent - position.minScrollExtent + rect.height;
        if (!totalHeight.isFinite || totalHeight > maxHeight) {
          throw StateError(
              'Full-page screenshot exceeds maxHeight ($maxHeight)');
        }
        _checkImageSize(rect.width, totalHeight, pixelRatio);
        if (++count > 200)
          throw StateError('Full-page screenshot exceeds 200 segments');
        final offset = position.pixels - position.minScrollExtent;
        final overlap = covered - offset;
        final stripHeight = rect.height - overlap;
        if (overlap < -0.01 || stripHeight <= 0) {
          throw StateError(
              'Scroll view made no progress or changed content during screenshot');
        }
        final captureOffset = position.pixels;
        // Snapshot only the viewport's retained layer. Cropping the root scene
        // also includes sibling overlays (floating tabs/FABs), hiding content
        // and repeating those controls at every stitching seam.
        final image = await _captureScrollViewport(viewport, pixelRatio);
        try {
          if (!state.mounted ||
              !identical(state.position, position) ||
              position.pixels != captureOffset) {
            throw StateError('Scroll view changed during screenshot');
          }
          canvas.drawImageRect(
            image,
            Rect.fromLTWH(0, overlap * pixelRatio, rect.width * pixelRatio,
                stripHeight * pixelRatio),
            Rect.fromLTWH(0, covered, rect.width, stripHeight),
            ui.Paint(),
          );
        } finally {
          image.dispose();
        }
        covered += stripHeight;
        if (position.pixels >= position.maxScrollExtent - 0.01) break;
        position.jumpTo((position.minScrollExtent + covered)
            .clamp(position.minScrollExtent, position.maxScrollExtent));
      }
      final picture = recorder.endRecording();
      late final ui.Image image;
      try {
        image = await picture.toImage(
            (rect.width * pixelRatio).ceil(), (covered * pixelRatio).ceil());
      } finally {
        picture.dispose();
      }
      try {
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        if (bytes == null)
          throw StateError('Failed to encode full-page screenshot');
        return {
          'success': true,
          'format': 'png',
          'screenshot': base64Encode(bytes.buffer.asUint8List()),
          'width': rect.width,
          'height': covered,
          'pixelRatio': pixelRatio,
        };
      } finally {
        image.dispose();
      }
    } finally {
      if (recorder.isRecording) recorder.endRecording().dispose();
      if (state.mounted && identical(state.position, position)) {
        position.jumpTo(originalOffset);
        await _waitForFrame();
      }
    }
  }

  static RenderBox? _findViewport(RenderObject root) {
    if (root is RenderBox && root is RenderAbstractViewport) {
      return root;
    }
    RenderBox? result;
    root.visitChildren((child) {
      result ??= _findViewport(child);
    });
    return result;
  }

  static Future<ui.Image> _captureScrollViewport(
      RenderBox viewport, double pixelRatio) async {
    // The protected layer getter is also available in profile/release, unlike
    // debugLayer. Never detach or repaint the live tree to remove overlays.
    // ignore: invalid_use_of_protected_member
    final layer = viewport.layer;
    if (layer is! OffsetLayer) {
      throw StateError('Scroll viewport has no isolated capture layer');
    }
    return layer.toImage(Offset.zero & viewport.size, pixelRatio: pixelRatio);
  }

  static void _checkImageSize(double width, double height, double pixelRatio) {
    final pixelWidth = (width * pixelRatio).ceil();
    final pixelHeight = (height * pixelRatio).ceil();
    if (pixelWidth > 32768 ||
        pixelHeight > 32768 ||
        pixelWidth * pixelHeight > 64000000) {
      throw StateError(
          'Full-page screenshot exceeds image size limit; reduce pixelRatio or content size');
    }
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

  /// Wait for pending builds and paint to reach the composited scene. The
  /// scheduler requests a frame when idle; this does not wait for animations
  /// to settle or manually drive the rendering pipeline.
  static Future<void> _waitForFrame() async {
    await WidgetsBinding.instance.endOfFrame;
  }
}
