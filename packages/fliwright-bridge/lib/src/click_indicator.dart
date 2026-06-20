import 'dart:ui' as ui;

import 'package:flutter/widgets.dart';

class ClickIndicator {
  static const Key indicatorKey = ValueKey('fliwright.clickIndicator');
  static const double size = 28;
  static const Duration duration = Duration(milliseconds: 450);
  static const ui.Color color = ui.Color(0xFF2196F3);

  static void show(Offset position) {
    final overlay = _findRootOverlay();
    if (overlay == null) return;

    late final OverlayEntry entry;
    entry = OverlayEntry(
      builder: (context) =>
          _ClickRipple(position: position, onCompleted: entry.remove),
    );
    overlay.insert(entry);
  }

  static OverlayState? _findRootOverlay() {
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

class _ClickRipple extends StatefulWidget {
  const _ClickRipple({required this.position, required this.onCompleted});

  final Offset position;
  final VoidCallback onCompleted;

  @override
  State<_ClickRipple> createState() => _ClickRippleState();
}

class _ClickRippleState extends State<_ClickRipple>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _progress;
  var _removed = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: ClickIndicator.duration,
    );
    _progress = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutCubic,
    );
    _controller.addStatusListener((status) {
      if (status == AnimationStatus.completed) {
        _remove();
      }
    });
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _remove() {
    if (_removed) return;
    _removed = true;
    widget.onCompleted();
  }

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: widget.position.dx - ClickIndicator.size / 2,
      top: widget.position.dy - ClickIndicator.size / 2,
      width: ClickIndicator.size,
      height: ClickIndicator.size,
      child: IgnorePointer(
        key: ClickIndicator.indicatorKey,
        child: RepaintBoundary(
          child: AnimatedBuilder(
            animation: _progress,
            builder: (context, child) {
              return CustomPaint(painter: _ClickRipplePainter(_progress.value));
            },
          ),
        ),
      ),
    );
  }
}

class _ClickRipplePainter extends CustomPainter {
  const _ClickRipplePainter(this.progress);

  final double progress;

  @override
  void paint(ui.Canvas canvas, ui.Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = ui.lerpDouble(4, ClickIndicator.size / 2, progress)!;
    final opacity = 1 - progress;

    final fill = Paint()
      ..color = ClickIndicator.color.withOpacity(0.16 * opacity)
      ..style = PaintingStyle.fill;
    final stroke = Paint()
      ..color = ClickIndicator.color.withOpacity(0.85 * opacity)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    final dot = Paint()
      ..color = ClickIndicator.color.withOpacity(0.95 * opacity)
      ..style = PaintingStyle.fill;

    canvas.drawCircle(center, radius, fill);
    canvas.drawCircle(center, radius, stroke);
    canvas.drawCircle(center, ui.lerpDouble(3, 1.5, progress)!, dot);
  }

  @override
  bool shouldRepaint(_ClickRipplePainter oldDelegate) {
    return oldDelegate.progress != progress;
  }
}
