import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import 'ref_registry.dart';

class ActionabilityException implements Exception {
  const ActionabilityException({
    required this.ref,
    required this.reason,
  });

  final String ref;
  final String reason;

  @override
  String toString() => 'Actionability failed for $ref: $reason';
}

Future<void> ensureActionable(
  RefEntry entry, {
  required String ref,
  bool checkStable = true,
  bool checkReceivesEvents = false,
}) async {
  final renderObject = _findRenderObject(entry.element, ref);
  if (!renderObject.attached) {
    throw ActionabilityException(
      ref: ref,
      reason: 'defunct (render object detached)',
    );
  }

  if (entry.enabled == false) {
    throw ActionabilityException(ref: ref, reason: 'not enabled');
  }

  var rect = entry.rect;
  if (rect.width <= 0 || rect.height <= 0) {
    throw ActionabilityException(ref: ref, reason: 'zero rect');
  }
  rect = _liveRectOf(entry.element) ?? rect;

  final view = _firstFlutterView();
  if (view == null) return;

  final viewport = _logicalViewport(view);
  if (!rect.overlaps(viewport)) {
    await _tryScrollIntoView(entry.element);
    rect = _liveRectOf(entry.element) ?? rect;
    if (!rect.overlaps(viewport)) {
      throw ActionabilityException(
        ref: ref,
        reason: 'off-viewport (rect=$rect, viewport=$viewport)',
      );
    }
  }

  if (checkStable) {
    await _awaitFrameOrTimeout();
    final liveRect = _liveRectOf(entry.element);
    if (liveRect != null) {
      final drift = _maxSideDelta(rect, liveRect);
      if (drift > 0.5) {
        throw ActionabilityException(
          ref: ref,
          reason: 'not stable (rect changed by ${drift.toStringAsFixed(1)}px)',
        );
      }
      rect = liveRect;
    }
  }

  if (checkReceivesEvents) {
    final target = entry.element.findRenderObject();
    if (target == null) return;

    final result = BoxHitTestResult();
    RendererBinding.instance.hitTestInView(result, rect.center, view.viewId);
    final path = result.path.toList(growable: false);
    final receivesEvents = path.any(
      (hit) =>
          identical(hit.target, target) ||
          _isRenderObjectDescendant(hit.target, target),
    );
    if (!receivesEvents && path.isNotEmpty && !_isPlatformOnlyPath(path)) {
      throw ActionabilityException(
        ref: ref,
        reason:
            'obscured by other widget (top=${path.first.target.runtimeType})',
      );
    }
  }
}

RenderObject _findRenderObject(Element element, String ref) {
  try {
    final renderObject = element.findRenderObject();
    if (renderObject == null) {
      throw ActionabilityException(
        ref: ref,
        reason: 'defunct (element has no render object)',
      );
    }
    return renderObject;
  } on FlutterError catch (error) {
    final message = error.message;
    if (message.contains('inactive element') ||
        message.contains('_ElementLifecycle.defunct')) {
      throw ActionabilityException(
        ref: ref,
        reason: 'defunct (element no longer mounted)',
      );
    }
    rethrow;
  }
}

ui.FlutterView? _firstFlutterView() {
  final views = WidgetsBinding.instance.platformDispatcher.views;
  final iterator = views.iterator;
  return iterator.moveNext() ? iterator.current : null;
}

Rect _logicalViewport(ui.FlutterView view) {
  final size = view.physicalSize;
  final dpr = view.devicePixelRatio;
  return Rect.fromLTWH(0, 0, size.width / dpr, size.height / dpr);
}

Future<void> _tryScrollIntoView(Element element) async {
  final renderObject = element.renderObject;
  if (renderObject == null || !renderObject.attached) return;
  if (Scrollable.maybeOf(element) == null) return;

  renderObject.showOnScreen(duration: Duration.zero);
  await _awaitFrameOrTimeout();
}

Future<void> _awaitFrameOrTimeout() {
  final binding = WidgetsBinding.instance;
  if (!binding.hasScheduledFrame) return Future.value();
  return binding.endOfFrame.timeout(
    const Duration(milliseconds: 200),
    onTimeout: () {},
  );
}

Rect? _liveRectOf(Element element) {
  final renderObject = element.findRenderObject();
  if (renderObject is! RenderBox) return null;
  if (!renderObject.attached || !renderObject.hasSize) return null;
  final topLeft = renderObject.localToGlobal(Offset.zero);
  return topLeft & renderObject.size;
}

double _maxSideDelta(Rect a, Rect b) {
  var max = (a.left - b.left).abs();
  max = max < (a.top - b.top).abs() ? (a.top - b.top).abs() : max;
  max = max < (a.right - b.right).abs() ? (a.right - b.right).abs() : max;
  max = max < (a.bottom - b.bottom).abs() ? (a.bottom - b.bottom).abs() : max;
  return max;
}

bool _isRenderObjectDescendant(HitTestTarget target, RenderObject ancestor) {
  if (target is! RenderObject) return false;
  RenderObject? parent = target.parent;
  while (parent != null) {
    if (identical(parent, ancestor)) return true;
    parent = parent.parent;
  }
  return false;
}

bool _isPlatformOnlyPath(List<HitTestEntry<HitTestTarget>> path) {
  if (path.length != 1) return false;
  final name = path.first.target.runtimeType.toString();
  return name == 'RenderView' ||
      name == '_ReusableRenderView' ||
      name.endsWith('RenderView');
}
