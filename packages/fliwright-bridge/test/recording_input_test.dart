import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/extensions/recording_input.dart';

void main() {
  test('captures committed composing values and flushes the final value', () {
    final controller = TextEditingController();
    final values = <String>[];
    final subscription = FocusedTextInputSubscription(
      controller: controller,
      onValue: values.add,
    );

    controller.value = const TextEditingValue(
      text: 'ni',
      composing: TextRange(start: 0, end: 2),
    );
    expect(values, isEmpty);

    controller.value = const TextEditingValue(text: '你');
    expect(values, ['你']);

    controller.clear();
    expect(values, ['你', '']);

    subscription.dispose(flush: true);
    controller.text = 'ignored after dispose';
    expect(values, ['你', '']);
    controller.dispose();
  });

  test('flushes a value changed while composing and removes its listener', () {
    final controller = TextEditingController();
    final values = <String>[];
    final subscription = FocusedTextInputSubscription(
      controller: controller,
      onValue: values.add,
    );

    controller.value = const TextEditingValue(
      text: '候选',
      composing: TextRange(start: 0, end: 2),
    );
    subscription.flush();
    expect(values, ['候选']);
    subscription.dispose();
    controller.dispose();
  });
}
