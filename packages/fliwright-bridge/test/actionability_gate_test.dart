import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/actionability_gate.dart';
import 'package:fliwright_bridge/src/ref_registry.dart';

void main() {
  testWidgets('passes for an attached enabled non-zero target', (tester) async {
    final entry = await _entryFor(tester, enabled: true);

    await expectLater(
      ensureActionable(entry, ref: 'e1', checkStable: false),
      completes,
    );
  });

  testWidgets('fails when target is disabled', (tester) async {
    final entry = await _entryFor(tester, enabled: false);

    await expectLater(
      ensureActionable(entry, ref: 'e1', checkStable: false),
      throwsA(
        isA<ActionabilityException>()
            .having((error) => error.reason, 'reason', 'not enabled'),
      ),
    );
  });

  testWidgets('fails when target rect is zero', (tester) async {
    final entry = await _entryFor(
      tester,
      enabled: true,
      rect: Rect.zero,
    );

    await expectLater(
      ensureActionable(entry, ref: 'e1', checkStable: false),
      throwsA(
        isA<ActionabilityException>()
            .having((error) => error.reason, 'reason', 'zero rect'),
      ),
    );
  });

  testWidgets('fails when element becomes defunct', (tester) async {
    final entry = await _entryFor(tester, enabled: true);
    await tester.pumpWidget(const SizedBox.shrink());

    await expectLater(
      ensureActionable(entry, ref: 'e1', checkStable: false),
      throwsA(
        isA<ActionabilityException>().having(
          (error) => error.reason,
          'reason',
          contains('defunct'),
        ),
      ),
    );
  });
}

Future<RefEntry> _entryFor(
  WidgetTester tester, {
  required bool enabled,
  Rect rect = const Rect.fromLTWH(0, 0, 100, 40),
}) async {
  await tester.pumpWidget(
    Directionality(
      textDirection: TextDirection.ltr,
      child: SizedBox(
        width: 100,
        height: 40,
        child: Text(enabled ? 'Enabled' : 'Disabled'),
      ),
    ),
  );
  final element = tester.element(find.text(enabled ? 'Enabled' : 'Disabled'));
  return RefEntry(
    rect: rect,
    element: element,
    groupId: 'test',
    isTextField: false,
    renderObject: element.renderObject,
    enabled: enabled,
  );
}
