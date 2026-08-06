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

  testWidgets('classifies a target below the keyboard viewport as obscured',
      (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetViewInsets);
    final entry = await _entryFor(tester, enabled: true, top: 880);

    await expectLater(
      ensureActionable(entry, ref: 'e1', checkStable: false),
      throwsA(
        isA<ActionabilityException>()
            .having(
              (error) => error.keyboardObscured,
              'keyboardObscured',
              isTrue,
            )
            .having(
              (error) => error.reason,
              'reason',
              contains('covered by soft keyboard'),
            ),
      ),
    );
  });
}

Future<RefEntry> _entryFor(
  WidgetTester tester, {
  required bool enabled,
  Rect rect = const Rect.fromLTWH(0, 0, 100, 40),
  double top = 0,
}) async {
  await tester.pumpWidget(
    Directionality(
      textDirection: TextDirection.ltr,
      child: Stack(
        children: [
          Positioned(
            left: 0,
            top: top,
            width: 100,
            height: 40,
            child: Text(enabled ? 'Enabled' : 'Disabled'),
          ),
        ],
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
