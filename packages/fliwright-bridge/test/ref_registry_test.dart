import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/ref_registry.dart';

void main() {
  tearDown(RefRegistry.resetForTesting);

  testWidgets('registers snapshot entries with e refs', (tester) async {
    await tester.pumpWidget(_testText('Submit'));
    final element = tester.element(find.text('Submit'));
    final renderObject = element.renderObject;

    final ref = RefRegistry.registerEntry(
      rect: const Rect.fromLTWH(1, 2, 100, 40),
      element: element,
      groupId: 'snapshot-a',
      isTextField: false,
      renderObject: renderObject,
      role: 'button',
      label: 'Submit',
    );

    expect(ref, 'e1');
    final entry = RefRegistry.lookupEntry(ref);
    expect(entry, isNotNull);
    expect(entry!.element, same(element));
    expect(entry.rect, const Rect.fromLTWH(1, 2, 100, 40));
    expect(entry.groupId, 'snapshot-a');
    expect(entry.role, 'button');
    expect(entry.label, 'Submit');
  });

  testWidgets('dedupes entries by semantics id and refreshes payload',
      (tester) async {
    await tester.pumpWidget(_testText('Submit'));
    final element = tester.element(find.text('Submit'));

    final first = RefRegistry.registerEntry(
      rect: const Rect.fromLTWH(0, 0, 50, 20),
      element: element,
      groupId: 'snapshot-old',
      isTextField: false,
      semanticsId: 42,
      label: 'Old',
    );
    final second = RefRegistry.registerEntry(
      rect: const Rect.fromLTWH(10, 20, 60, 30),
      element: element,
      groupId: 'snapshot-new',
      isTextField: false,
      semanticsId: 42,
      label: 'New',
    );

    expect(second, first);
    final entry = RefRegistry.lookupEntry(first)!;
    expect(entry.groupId, 'snapshot-new');
    expect(entry.rect, const Rect.fromLTWH(10, 20, 60, 30));
    expect(entry.label, 'New');

    RefRegistry.disposeGroup('snapshot-old');
    expect(RefRegistry.lookupEntry(first), isNotNull);

    RefRegistry.disposeGroup('snapshot-new');
    expect(RefRegistry.lookupEntry(first), isNull);
  });

  testWidgets('mints fresh entries when semantics id is absent',
      (tester) async {
    await tester.pumpWidget(_testText('Submit'));
    final element = tester.element(find.text('Submit'));

    final first = RefRegistry.registerEntry(
      rect: Rect.zero,
      element: element,
      groupId: 'snapshot-a',
      isTextField: false,
    );
    final second = RefRegistry.registerEntry(
      rect: Rect.zero,
      element: element,
      groupId: 'snapshot-a',
      isTextField: false,
    );

    expect(first, 'e1');
    expect(second, 'e2');
    expect(RefRegistry.refsForGroup('snapshot-a'), ['e1', 'e2']);
  });

  test('registers q refs independently from e refs', () {
    final query = const QueryRef(text: 'Submit', role: 'button');

    final first = RefRegistry.registerQuery(query);
    final second = RefRegistry.registerQuery(query);

    expect(first, 'q1');
    expect(second, 'q2');
    expect(RefRegistry.lookupQuery(first), same(query));
    expect(RefRegistry.activeRefs(), containsAll(['q1', 'q2']));
  });

  test('rejects empty query refs', () {
    expect(
      () => RefRegistry.registerQuery(const QueryRef()),
      throwsA(isA<ArgumentError>()),
    );
  });
}

Widget _testText(String value) {
  return Directionality(
    textDirection: TextDirection.ltr,
    child: Text(value),
  );
}
