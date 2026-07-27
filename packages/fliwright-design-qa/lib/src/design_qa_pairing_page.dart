import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'design_qa_controller.dart';

typedef DesignQaScannerBuilder = Widget Function(
  BuildContext context,
  ValueChanged<String> onPayload,
  ValueChanged<Object> onError,
);

/// Debug-only page that scans the payload shown by the Figma Design QA plugin.
///
/// The page pops as soon as pairing completes so shake-to-capture always runs
/// over the host application's actual interface rather than this camera view.
class DesignQaPairingPage extends StatefulWidget {
  const DesignQaPairingPage({
    required this.controller,
    this.scannerBuilder,
    this.onPaired,
    super.key,
  });

  final DesignQaController controller;
  final DesignQaScannerBuilder? scannerBuilder;
  final VoidCallback? onPaired;

  @override
  State<DesignQaPairingPage> createState() => _DesignQaPairingPageState();
}

enum _PairingStage { scanning, pairing, cameraError, pairingError }

class _DesignQaPairingPageState extends State<DesignQaPairingPage> {
  late final MobileScannerController? _scannerController =
      widget.scannerBuilder == null
          ? MobileScannerController(
              formats: const [BarcodeFormat.qrCode],
              detectionSpeed: DetectionSpeed.noDuplicates,
            )
          : null;
  var _stage = _PairingStage.scanning;

  @override
  void dispose() {
    final controller = _scannerController;
    if (controller != null) {
      unawaited(controller.dispose());
    }
    super.dispose();
  }

  Future<void> _pair(String payload) async {
    if (_stage != _PairingStage.scanning) {
      return;
    }
    setState(() => _stage = _PairingStage.pairing);

    try {
      await _scannerController?.stop();
      await widget.controller.pairFromQrPayload(payload);
      if (!mounted) {
        return;
      }
      widget.onPaired?.call();
      Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        setState(() => _stage = _PairingStage.pairingError);
      }
    }
  }

  void _handleCameraError(Object _) {
    if (_stage == _PairingStage.scanning && mounted) {
      setState(() => _stage = _PairingStage.cameraError);
    }
  }

  Future<void> _retry() async {
    setState(() => _stage = _PairingStage.scanning);
    try {
      await _scannerController?.start();
    } catch (_) {
      if (mounted) {
        setState(() => _stage = _PairingStage.cameraError);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: const Color(0xFF101418),
      body: Stack(
        fit: StackFit.expand,
        children: [
          _buildScanner(),
          const ColoredBox(color: Color(0x33000000)),
          SafeArea(
            child: Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(16, 8, 16, 24),
              child: Column(
                children: [
                  Row(
                    children: [
                      IconButton(
                        key: const Key('fliwright.designQa.pairing.close'),
                        tooltip: MaterialLocalizations.of(context)
                            .closeButtonTooltip,
                        color: Colors.white,
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.of(context).maybePop(),
                      ),
                      const SizedBox(width: 8),
                      const Expanded(
                        child: Text(
                          'Pair with Figma',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const Spacer(),
                  const _ScanWindow(),
                  const SizedBox(height: 20),
                  const Text(
                    'Scan the pairing code from the Figma plugin',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Color(0xFFF3F5F7), fontSize: 16),
                  ),
                  const Spacer(),
                  _buildControls(colorScheme),
                ],
              ),
            ),
          ),
          if (_stage == _PairingStage.pairing)
            const Center(
              child: SizedBox(
                width: 40,
                height: 40,
                child: CircularProgressIndicator(color: Color(0xFF57D2C6)),
              ),
            ),
          if (_stage == _PairingStage.cameraError ||
              _stage == _PairingStage.pairingError)
            Center(child: _buildError(colorScheme)),
        ],
      ),
    );
  }

  Widget _buildScanner() {
    final builder = widget.scannerBuilder;
    if (builder != null) {
      return builder(context, _pair, _handleCameraError);
    }

    final controller = _scannerController!;
    return MobileScanner(
      controller: controller,
      onDetect: (capture) {
        for (final barcode in capture.barcodes) {
          final payload = barcode.rawValue;
          if (payload != null && payload.isNotEmpty) {
            unawaited(_pair(payload));
            return;
          }
        }
      },
      onDetectError: (error, _) => _handleCameraError(error),
      errorBuilder: (_, __) => _CameraErrorView(onRetry: _retry),
    );
  }

  Widget _buildControls(ColorScheme colorScheme) {
    final controller = _scannerController;
    if (_stage != _PairingStage.scanning || controller == null) {
      return const SizedBox(height: 48);
    }

    return ValueListenableBuilder<MobileScannerState>(
      valueListenable: controller,
      builder: (context, state, _) {
        final enabled = state.isInitialized && state.isRunning;
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            IconButton.filledTonal(
              tooltip: 'Toggle flashlight',
              color: colorScheme.onSecondaryContainer,
              icon: Icon(
                state.torchState == TorchState.on
                    ? Icons.flash_on
                    : Icons.flash_off,
              ),
              onPressed: enabled ? controller.toggleTorch : null,
            ),
            const SizedBox(width: 20),
            IconButton.filledTonal(
              tooltip: 'Switch camera',
              color: colorScheme.onSecondaryContainer,
              icon: const Icon(Icons.cameraswitch_outlined),
              onPressed: enabled ? controller.switchCamera : null,
            ),
          ],
        );
      },
    );
  }

  Widget _buildError(ColorScheme colorScheme) {
    final isCameraError = _stage == _PairingStage.cameraError;
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0xF5101418),
        borderRadius: BorderRadius.all(Radius.circular(8)),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 320),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isCameraError ? Icons.videocam_off_outlined : Icons.link_off,
                color: const Color(0xFFFF8E72),
                size: 32,
              ),
              const SizedBox(height: 12),
              Text(
                isCameraError
                    ? 'Camera unavailable'
                    : 'Unable to pair with Figma',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                isCameraError
                    ? 'Allow camera access, then try again.'
                    : 'Scan an active pairing code and try again.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFFBEC7CE)),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                key: const Key('fliwright.designQa.pairing.retry'),
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF57D2C6),
                  foregroundColor: const Color(0xFF10201F),
                ),
                onPressed: _retry,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ScanWindow extends StatelessWidget {
  const _ScanWindow();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 224,
      height: 224,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.fromBorderSide(
            BorderSide(color: Color(0xFF57D2C6), width: 3),
          ),
          borderRadius: BorderRadius.all(Radius.circular(8)),
        ),
      ),
    );
  }
}

class _CameraErrorView extends StatelessWidget {
  const _CameraErrorView({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF101418),
      child: Center(
        child: IconButton.filledTonal(
          tooltip: 'Retry camera',
          icon: const Icon(Icons.refresh),
          onPressed: onRetry,
        ),
      ),
    );
  }
}
