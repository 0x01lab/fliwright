import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import 'protocol.dart';
import 'transport.dart';

class DesignQaRenderViewScreenshotProvider
    implements DesignQaScreenshotProvider {
  const DesignQaRenderViewScreenshotProvider({
    this.pixelRatio = 1,
    this.deviceModel = 'unknown',
    this.appVersionBuild = 'unknown',
    DateTime Function()? clock,
  }) : _clock = clock;

  final double pixelRatio;
  final String deviceModel;
  final String appVersionBuild;
  final DateTime Function()? _clock;

  @override
  Future<DesignQaCapture> capture() async {
    await _waitForFrame();

    final renderViews = RendererBinding.instance.renderViews;
    if (renderViews.isEmpty) {
      throw StateError(
        'No Flutter render view is available for Design QA capture.',
      );
    }

    final renderView = renderViews.firstWhere(
      (view) => view.size.width > 0 && view.size.height > 0,
      orElse: () => renderViews.first,
    );
    // RenderView owns the composited root layer used for a clean Flutter frame.
    // ignore: invalid_use_of_protected_member
    final layer = renderView.layer;
    if (layer == null) {
      throw StateError('The Flutter render view has no layer to capture.');
    }
    if (layer is! OffsetLayer) {
      throw StateError('The Flutter render view layer is not an OffsetLayer.');
    }

    final viewPixelRatio = renderView.configuration.devicePixelRatio;
    final image = await layer.toImage(
      renderView.paintBounds,
      pixelRatio: pixelRatio / viewPixelRatio,
    );

    try {
      final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
      if (byteData == null) {
        throw StateError('Unable to encode the Design QA screenshot as PNG.');
      }

      final bytes = Uint8List.view(
        byteData.buffer,
        byteData.offsetInBytes,
        byteData.lengthInBytes,
      );
      return DesignQaCapture(
        pngBytes: bytes,
        device: DesignQaDeviceContext(
          model: deviceModel,
          platform: defaultTargetPlatform.name,
          osVersion: _osVersion(),
          screenWidth: renderView.size.width.round(),
          screenHeight: renderView.size.height.round(),
          appVersionBuild: appVersionBuild,
          capturedAt: (_clock ?? DateTime.now)(),
        ),
      );
    } finally {
      image.dispose();
    }
  }

  Future<void> _waitForFrame() {
    final completer = Completer<void>();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      completer.complete();
    });
    WidgetsBinding.instance.ensureVisualUpdate();
    return completer.future;
  }

  String _osVersion() {
    try {
      return Platform.operatingSystemVersion;
    } catch (_) {
      return 'unknown';
    }
  }
}
