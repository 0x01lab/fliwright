import 'package:flutter/material.dart';
import 'package:fliwright_design_qa/fliwright_design_qa.dart';

import '../bridge.dart';

typedef DesignQaPairingPageBuilder = Widget Function(
    DesignQaController controller);

class FliwrightDesignQaExtension {
  const FliwrightDesignQaExtension({
    required this.controller,
    this.pairingPageBuilder,
  });

  static const statusMethod = 'ext.fliwright.designQa.status';
  static const diagnosticsMethod = 'ext.fliwright.designQa.diagnostics';
  static const pairMethod = 'ext.fliwright.designQa.pair';
  static const captureMethod = 'ext.fliwright.designQa.capture';
  static const startShakeMethod = 'ext.fliwright.designQa.startShake';
  static const stopShakeMethod = 'ext.fliwright.designQa.stopShake';
  static const openPairingMethod = 'ext.fliwright.designQa.openPairing';
  static const closeMethod = 'ext.fliwright.designQa.close';
  static const registeredMethods = <String>[
    statusMethod,
    diagnosticsMethod,
    pairMethod,
    captureMethod,
    startShakeMethod,
    stopShakeMethod,
    openPairingMethod,
    closeMethod,
  ];

  final DesignQaController controller;
  final DesignQaPairingPageBuilder? pairingPageBuilder;

  static DesignQaController registerDefault(
    ExtensionRegistry registry, {
    DesignQaControllerConfig config = const DesignQaControllerConfig(),
    String peerKey = 'peerjs',
  }) {
    final controller = DesignQaController.withPlatformAdapters(
      config: config,
      peerKey: peerKey,
    );
    FliwrightDesignQaExtension(controller: controller).register(registry);
    return controller;
  }

  void register(ExtensionRegistry registry) {
    _registerIfNeeded(registry, statusMethod, _status);
    _registerIfNeeded(registry, diagnosticsMethod, _diagnostics);
    _registerIfNeeded(registry, pairMethod, _pair);
    _registerIfNeeded(registry, captureMethod, _capture);
    _registerIfNeeded(registry, startShakeMethod, _startShake);
    _registerIfNeeded(registry, stopShakeMethod, _stopShake);
    _registerIfNeeded(registry, openPairingMethod, _openPairing);
    _registerIfNeeded(registry, closeMethod, _close);
  }

  void _registerIfNeeded(
    ExtensionRegistry registry,
    String method,
    ExtensionHandler handler,
  ) {
    if (registry.isRegistered(method)) {
      return;
    }
    registry.register(method, handler);
  }

  Future<Map<String, dynamic>> _status(Map<String, String> params) async {
    return {'success': true, 'designQa': _snapshotToJson(controller.snapshot)};
  }

  Future<Map<String, dynamic>> _diagnostics(Map<String, String> params) async {
    final qrPayload = params['qrPayload'] ?? params['payload'];
    try {
      final payload = qrPayload == null || qrPayload.trim().isEmpty
          ? controller.pairingPayload
          : DesignQaPairingPayload.parse(qrPayload);
      return {
        'success': payload != null,
        if (payload == null)
          'error': 'No paired Design QA session or qrPayload provided.',
        if (payload != null) 'pairing': _pairingPayloadToJson(payload),
        if (payload != null)
          'signaling': DesignQaPeerServerConfig.fromPairingPayload(
            payload,
          ).toJson(),
        'designQa': _snapshotToJson(controller.snapshot),
      };
    } catch (error) {
      return {
        'success': false,
        'error': error.toString(),
        'designQa': _snapshotToJson(controller.snapshot),
      };
    }
  }

  Future<Map<String, dynamic>> _pair(Map<String, String> params) async {
    final qrPayload = params['qrPayload'] ?? params['payload'];
    if (qrPayload == null || qrPayload.trim().isEmpty) {
      return {
        'success': false,
        'error': 'Missing parameter: qrPayload',
        'designQa': _snapshotToJson(controller.snapshot),
      };
    }

    try {
      await controller.pairFromQrPayload(qrPayload);
      final payload = controller.pairingPayload;
      return {
        'success': true,
        if (payload != null) 'pairing': _pairingPayloadToJson(payload),
        if (payload != null)
          'signaling': DesignQaPeerServerConfig.fromPairingPayload(
            payload,
          ).toJson(),
        'designQa': _snapshotToJson(controller.snapshot),
      };
    } catch (error) {
      return {
        'success': false,
        'error': error.toString(),
        'designQa': _snapshotToJson(controller.snapshot),
      };
    }
  }

  Future<Map<String, dynamic>> _capture(Map<String, String> params) async {
    try {
      final result = await controller.captureNow();
      return {
        'success': result != null,
        if (result == null) 'error': 'Design QA is not paired or enabled.',
        'result': _captureResultToJson(result),
        'designQa': _snapshotToJson(controller.snapshot),
      };
    } catch (error) {
      return {
        'success': false,
        'error': error.toString(),
        'designQa': _snapshotToJson(controller.snapshot),
      };
    }
  }

  Future<Map<String, dynamic>> _startShake(Map<String, String> params) async {
    controller.startShakeCapture();
    return {
      'success': controller.snapshot.state == DesignQaControllerState.listening,
      if (controller.snapshot.state != DesignQaControllerState.listening)
        'error': 'Design QA is not paired or enabled.',
      'designQa': _snapshotToJson(controller.snapshot),
    };
  }

  Future<Map<String, dynamic>> _stopShake(Map<String, String> params) async {
    await controller.stopShakeCapture();
    return {'success': true, 'designQa': _snapshotToJson(controller.snapshot)};
  }

  Future<Map<String, dynamic>> _openPairing(Map<String, String> params) async {
    final root = WidgetsBinding.instance.rootElement;
    final navigator =
        _routerNavigator() ?? (root == null ? null : _findNavigatorState(root));
    if (navigator == null) {
      return {
        'success': false,
        'error': 'No Navigator is available to open Design QA pairing.',
        'designQa': _snapshotToJson(controller.snapshot),
      };
    }

    navigator.push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) =>
            pairingPageBuilder?.call(controller) ??
            DesignQaPairingPage(controller: controller),
      ),
    );
    return {
      'success': true,
      'designQa': _snapshotToJson(controller.snapshot),
    };
  }

  Future<Map<String, dynamic>> _close(Map<String, String> params) async {
    await controller.close();
    return {'success': true, 'designQa': _snapshotToJson(controller.snapshot)};
  }

  Map<String, Object?> _snapshotToJson(DesignQaControllerSnapshot snapshot) {
    return {
      'state': snapshot.state.name,
      if (snapshot.sessionId != null) 'sessionId': snapshot.sessionId,
      if (snapshot.lastCapture != null)
        'lastCapture': _captureResultToJson(snapshot.lastCapture),
      if (snapshot.error != null) 'error': snapshot.error.toString(),
    };
  }

  Map<String, Object?> _pairingPayloadToJson(DesignQaPairingPayload payload) {
    return {
      'version': payload.version,
      'signalingUrl': payload.signalingUrl,
      'roomId': payload.roomId,
      'iceConfigId': payload.iceConfigId,
    };
  }

  Map<String, Object?>? _captureResultToJson(DesignQaCaptureResult? result) {
    if (result == null) {
      return null;
    }

    return {
      'sessionId': result.sessionId,
      'transferId': result.transferId,
      'totalBytes': result.totalBytes,
      'chunkCount': result.chunkCount,
      'sha256': result.sha256,
    };
  }

  NavigatorState? _findNavigatorState(Element root) {
    NavigatorState? result;

    void visit(Element element) {
      if (element is StatefulElement && element.state is NavigatorState) {
        result = element.state as NavigatorState;
      }
      element.visitChildren(visit);
    }

    root.visitChildren(visit);
    return result;
  }

  NavigatorState? _routerNavigator() {
    final router = FliwrightBridge.router;
    if (router == null) {
      return null;
    }

    try {
      final navigatorKey = (router as dynamic).routerDelegate.navigatorKey;
      if (navigatorKey is GlobalKey<NavigatorState>) {
        return navigatorKey.currentState;
      }
    } catch (_) {
      // Apps without GoRouter still use the widget-tree fallback.
    }
    return null;
  }
}
