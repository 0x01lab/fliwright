import 'dart:async';

import 'package:flutter/material.dart';

import 'protocol.dart';
import 'transport.dart';

abstract interface class DesignQaCaptureFeedback {
  void begin(DesignQaCapture capture);

  void complete(DesignQaCaptureResult result);

  void dismiss();
}

/// Displays the captured PNG as a non-interactive thumbnail during transfer.
class DesignQaCaptureSuccessIndicator implements DesignQaCaptureFeedback {
  static const Key indicatorKey = ValueKey('fliwright.designQa.captureSuccess');
  static const Key confirmationKey =
      ValueKey('fliwright.designQa.captureSuccess.confirmation');
  static const Duration travelDuration = Duration(milliseconds: 650);
  static const Duration confirmationDuration = Duration(milliseconds: 260);
  static const Duration confirmationVisibleDuration =
      Duration(milliseconds: 900);
  static const Duration dismissDuration = Duration(milliseconds: 180);

  _CaptureTransferHandle? _active;

  @override
  void begin(DesignQaCapture capture) {
    dismiss();
    final overlay = _findRootOverlay();
    if (overlay == null) return;

    final key = GlobalKey<_CaptureTransferAnimationState>();
    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (_) => _CaptureTransferAnimation(
        key: key,
        capture: capture,
        onDismissed: entry.remove,
      ),
    );
    overlay.insert(entry);
    _active = _CaptureTransferHandle(entry, key);
  }

  @override
  void complete(DesignQaCaptureResult _) => _active?.complete();

  @override
  void dismiss() {
    _active?.dismiss();
    _active = null;
  }

  OverlayState? _findRootOverlay() {
    final root = WidgetsBinding.instance.rootElement;
    if (root == null) return null;
    OverlayState? overlay;
    void visit(Element element) {
      if (overlay != null) return;
      if (element is StatefulElement && element.state is OverlayState) {
        overlay = element.state as OverlayState;
        return;
      }
      element.visitChildElements(visit);
    }

    visit(root);
    return overlay;
  }
}

class _CaptureTransferHandle {
  const _CaptureTransferHandle(this.entry, this.key);

  final OverlayEntry entry;
  final GlobalKey<_CaptureTransferAnimationState> key;

  void complete() => key.currentState?.complete();

  void dismiss() {
    final state = key.currentState;
    if (state != null) {
      state.dismiss();
    } else {
      entry.remove();
    }
  }
}

class _CaptureTransferAnimation extends StatefulWidget {
  const _CaptureTransferAnimation({
    required this.capture,
    required this.onDismissed,
    super.key,
  });

  final DesignQaCapture capture;
  final VoidCallback onDismissed;

  @override
  State<_CaptureTransferAnimation> createState() =>
      _CaptureTransferAnimationState();
}

class _CaptureTransferAnimationState extends State<_CaptureTransferAnimation>
    with TickerProviderStateMixin {
  late final AnimationController _travelController;
  late final AnimationController _confirmationController;
  Timer? _completionTimer;
  Timer? _dismissTimer;
  var _transferComplete = false;
  var _isDismissing = false;
  var _removed = false;

  @override
  void initState() {
    super.initState();
    _travelController = AnimationController(
      vsync: this,
      duration: DesignQaCaptureSuccessIndicator.travelDuration,
    );
    _confirmationController = AnimationController(
      vsync: this,
      duration: DesignQaCaptureSuccessIndicator.confirmationDuration,
    );
    _travelController.forward();
  }

  @override
  void dispose() {
    _completionTimer?.cancel();
    _dismissTimer?.cancel();
    _travelController.dispose();
    _confirmationController.dispose();
    super.dispose();
  }

  void complete() {
    if (_removed) return;
    _transferComplete = true;
    final remaining = Duration(
      microseconds:
          (DesignQaCaptureSuccessIndicator.travelDuration.inMicroseconds *
                  (1 - _travelController.value))
              .round(),
    );
    if (remaining == Duration.zero) {
      _showConfirmation();
    } else {
      _completionTimer = Timer(remaining, _showConfirmation);
    }
  }

  void _showConfirmation() {
    if (_confirmationController.isAnimating ||
        _confirmationController.isCompleted) {
      return;
    }
    _confirmationController.forward();
    _dismissTimer = Timer(
      DesignQaCaptureSuccessIndicator.confirmationDuration +
          DesignQaCaptureSuccessIndicator.confirmationVisibleDuration,
      _startDismiss,
    );
  }

  void _startDismiss() {
    if (_removed || !mounted) return;
    setState(() => _isDismissing = true);
    _dismissTimer = Timer(
      DesignQaCaptureSuccessIndicator.dismissDuration,
      dismiss,
    );
  }

  void dismiss() {
    if (_removed) return;
    _removed = true;
    widget.onDismissed();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: IgnorePointer(
        child: AnimatedOpacity(
          duration: DesignQaCaptureSuccessIndicator.dismissDuration,
          opacity: _isDismissing ? 0 : 1,
          child: AnimatedBuilder(
            animation: Listenable.merge([
              _travelController,
              _confirmationController,
            ]),
            builder: (context, _) {
              final travel = Curves.easeInOutCubic.transform(
                _travelController.value,
              );
              final check = Curves.easeOutBack.transform(
                _confirmationController.value,
              );
              final aspectRatio = (widget.capture.device.screenWidth /
                      widget.capture.device.screenHeight)
                  .clamp(0.4, 1.4)
                  .toDouble();
              return Align(
                alignment: Alignment.lerp(
                  Alignment.center,
                  const Alignment(0, 0.76),
                  travel,
                )!,
                child: Transform.scale(
                  scale: 1 - (0.56 * travel),
                  child: SizedBox(
                    key: DesignQaCaptureSuccessIndicator.indicatorKey,
                    width: 220,
                    child: AspectRatio(
                      aspectRatio: aspectRatio,
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          Positioned.fill(
                            child: ClipRRect(
                              borderRadius: const BorderRadius.all(
                                Radius.circular(8),
                              ),
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  border: Border.all(
                                    color: const Color(0xFF78E0D2),
                                    width: 2,
                                  ),
                                ),
                                child: Image.memory(
                                  widget.capture.pngBytes,
                                  fit: BoxFit.cover,
                                  gaplessPlayback: true,
                                ),
                              ),
                            ),
                          ),
                          if (_transferComplete)
                            Positioned(
                              top: -10,
                              right: -10,
                              child: Transform.scale(
                                scale: check,
                                child: const _FigmaConfirmation(),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _FigmaConfirmation extends StatelessWidget {
  const _FigmaConfirmation();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: Color(0xFF57D2C6),
        shape: BoxShape.circle,
      ),
      child: const SizedBox(
        key: DesignQaCaptureSuccessIndicator.confirmationKey,
        width: 40,
        height: 40,
        child: Icon(Icons.check_rounded, color: Color(0xFF10201F), size: 26),
      ),
    );
  }
}
