import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

class SoftKeyboardState {
  const SoftKeyboardState({
    required this.visible,
    required this.insetBottom,
    required this.viewport,
  });

  final bool visible;
  final double insetBottom;
  final Rect viewport;

  Rect get interactiveViewport => Rect.fromLTRB(
        viewport.left,
        viewport.top,
        viewport.right,
        (viewport.bottom - insetBottom).clamp(viewport.top, viewport.bottom),
      );

  Rect get keyboardRect => Rect.fromLTRB(
        viewport.left,
        interactiveViewport.bottom,
        viewport.right,
        viewport.bottom,
      );

  bool restricts(Offset point) {
    return visible &&
        point.dx >= viewport.left &&
        point.dx <= viewport.right &&
        point.dy >= interactiveViewport.bottom;
  }

  Map<String, dynamic> toJson() => {
        'visible': visible,
        'insetBottom': insetBottom,
      };
}

class SoftKeyboard {
  static SoftKeyboardState current() {
    final view = _flutterView();
    if (view == null) {
      return const SoftKeyboardState(
        visible: false,
        insetBottom: 0,
        viewport: Rect.zero,
      );
    }

    final devicePixelRatio = view.devicePixelRatio;
    final viewport = Offset.zero & (view.physicalSize / devicePixelRatio);
    final insetBottom = view.viewInsets.bottom / devicePixelRatio;
    return SoftKeyboardState(
      visible: insetBottom > 0,
      insetBottom: insetBottom,
      viewport: viewport,
    );
  }

  static Future<SoftKeyboardState> dismiss({
    Duration timeout = const Duration(milliseconds: 800),
  }) async {
    FocusManager.instance.primaryFocus?.unfocus();
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');

    final deadline = DateTime.now().add(timeout);
    var state = current();
    while (state.visible && DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 16));
      state = current();
    }
    return state;
  }

  static ui.FlutterView? _flutterView() {
    final dispatcher = WidgetsBinding.instance.platformDispatcher;
    final implicitView = dispatcher.implicitView;
    if (implicitView != null) return implicitView;
    final views = dispatcher.views.iterator;
    return views.moveNext() ? views.current : null;
  }
}
