import 'package:flutter/widgets.dart';

/// Observes committed values for one focused editable-text session.
class FocusedTextInputSubscription {
  FocusedTextInputSubscription({
    required this.controller,
    required this.onValue,
  }) : _lastCommittedValue = controller.text {
    controller.addListener(_handleControllerChange);
  }

  final TextEditingController controller;
  final ValueChanged<String> onValue;
  String _lastCommittedValue;
  bool _disposed = false;

  void flush() => _capture(force: true);

  void dispose({bool flush = false}) {
    if (_disposed) return;
    if (flush) this.flush();
    controller.removeListener(_handleControllerChange);
    _disposed = true;
  }

  void _handleControllerChange() => _capture(force: false);

  void _capture({required bool force}) {
    if (_disposed) return;
    final value = controller.value;
    if (!force && value.composing.isValid && !value.composing.isCollapsed) {
      return;
    }
    if (value.text == _lastCommittedValue) return;
    _lastCommittedValue = value.text;
    onValue(value.text);
  }
}
