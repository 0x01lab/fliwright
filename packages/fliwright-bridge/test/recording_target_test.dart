import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:fliwright_bridge/src/extensions/recording_target.dart';
import 'package:fliwright_bridge/src/extensions/inspect.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    await FliwrightBridge.reset();
    await FliwrightBridge.init();
  });
  tearDown(FliwrightBridge.reset);

  RecordingTargetCapture capture() =>
      RecordingTargetCapture(maxDuration: const Duration(seconds: 2));
  Map<String, dynamic> freeze(
          WidgetTester tester, RecordingTargetCapture capture, Finder finder) =>
      capture.freeze(tester.element(finder),
          root: WidgetsBinding.instance.rootElement!);

  testWidgets('keyed recording target does not probe unrelated ancestor names',
      (tester) async {
    var nameReads = 0;
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: _NamedRecordingFixture(
      onNameRead: () => nameReads++,
      child: TextButton(
          key: const ValueKey('save'),
          onPressed: () {},
          child: const Text('Save')),
    ))));
    final frozen =
        freeze(tester, capture(), find.byKey(const ValueKey('save')));
    expect(frozen['status'], 'resolved');
    expect((frozen['candidates'] as List).single['query'], {
      'match': {'key': 'save'}
    });
    expect(nameReads, 0,
        reason: 'A verified key does not need dynamic name fallback.');
  });

  testWidgets('freezes candidate counts from the same matcher as live resolve',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ElevatedButton(
      key: const ValueKey('save'),
      onPressed: () {},
      child: const Text('Save'),
    ))));
    final frozen =
        freeze(tester, capture(), find.byKey(const ValueKey('save')));
    expect(frozen['status'], 'resolved');
    expect(frozen['targetId'], isNotEmpty);
    final candidates =
        (frozen['candidates'] as List).cast<Map<String, dynamic>>();
    expect(candidates.first['query'], {
      'match': {'key': 'save'}
    });
    for (final candidate in candidates) {
      final live =
          await FliwrightBridge.registry.invoke('ext.fliwright.resolve', {
        'selector': jsonEncode(candidate['query']),
        'strict': 'false',
      });
      expect(candidate['matchCount'], live['count']);
      final matches = (live['matches'] as List).cast<Map<String, dynamic>>();
      expect(candidate['matchesTarget'],
          matches.any((match) => match['id'] == frozen['id']));
    }
  });

  testWidgets('disambiguates repeated labels and keys with a stable ancestor',
      (tester) async {
    Widget button() => ElevatedButton(
        key: const ValueKey('save'),
        onPressed: () {},
        child: const Text('Save'));
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Column(children: [
      Container(key: const ValueKey('billing'), child: button()),
      Container(key: const ValueKey('shipping'), child: button()),
    ]))));
    final frozen = freeze(
        tester,
        capture(),
        find.descendant(
          of: find.byKey(const ValueKey('shipping')),
          matching: find.byType(ElevatedButton),
        ));
    final candidates =
        (frozen['candidates'] as List).cast<Map<String, dynamic>>();
    final key =
        candidates.firstWhere((candidate) => candidate['stability'] == 'key');
    expect(key['matchCount'], 2);
    final scoped = candidates.where((candidate) =>
        candidate['stability'] == 'ancestor' &&
        candidate['matchCount'] == 1 &&
        candidate['matchesTarget'] == true);
    expect(scoped, isNotEmpty);
    expect(jsonEncode(scoped.toList()), contains('shipping'));
  });

  testWidgets(
      'preserves a proven key without spending the rest of the budget on weaker candidates',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: TextButton(
      key: const ValueKey('save'),
      onPressed: () {},
      child: const Text('Save'),
    ))));
    var nodes = 0;
    InspectExtension.walkTree(
        WidgetsBinding.instance.rootElement!, (_) => nodes++);
    final sampler = RecordingTargetCapture(
        maxVisits: nodes * 3 + 1, maxDuration: const Duration(seconds: 2));
    final frozen = freeze(tester, sampler, find.byKey(const ValueKey('save')));
    expect(frozen['status'], 'resolved');
    expect(frozen['candidates'], hasLength(1));
  });

  testWidgets('preserves old candidates after navigation destroys the target',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: ElevatedButton(
      key: const ValueKey('open'),
      onPressed: () {},
      child: const Text('Open'),
    ))));
    final sampler = capture();
    final frozen = freeze(tester, sampler, find.byKey(const ValueKey('open')));
    final before = jsonEncode(frozen);
    await tester.pumpWidget(const SizedBox());
    expect(jsonEncode(frozen), before);
    expect(frozen['candidates'], isNotEmpty);
  });

  testWidgets('freezes an unkeyed list control through its unique keyed item',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView.builder(
          itemCount: 100,
          itemBuilder: (_, index) => ListTile(
            key: ValueKey('item_$index'),
            title: Text('Item $index'),
          ),
        ),
      ),
    ));
    final target = find.descendant(
      of: find.byKey(const ValueKey('item_6')),
      matching: find.byType(InkWell),
    );
    var nodes = 0;
    InspectExtension.walkTree(
        WidgetsBinding.instance.rootElement!, (_) => nodes++);
    final sampler = RecordingTargetCapture(
      maxVisits: nodes * 3 + 100,
      maxDuration: const Duration(seconds: 2),
    );
    final frozen = freeze(tester, sampler, target);
    expect(frozen['status'], 'resolved');
    expect((frozen['candidates'] as List).single, {
      'query': {
        'match': {'type': 'InkWell'},
        'within': {
          'match': {'key': 'item_6'}
        },
      },
      'stability': 'ancestor',
      'matchCount': 1,
      'matchesTarget': true,
    });
  });

  testWidgets('identity follows the Element instance instead of its key',
      (tester) async {
    Widget app() => MaterialApp(
            home: Scaffold(
                body: TextButton(
          key: const ValueKey('same-key'),
          onPressed: () {},
          child: const Text('Again'),
        )));
    final sampler = capture();
    await tester.pumpWidget(app());
    final first =
        freeze(tester, sampler, find.byKey(const ValueKey('same-key')));
    final same =
        freeze(tester, sampler, find.byKey(const ValueKey('same-key')));
    expect(same['targetId'], first['targetId']);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(app());
    final rebuilt =
        freeze(tester, sampler, find.byKey(const ValueKey('same-key')));
    expect(rebuilt['targetId'], isNot(first['targetId']));
  });

  testWidgets(
      'returns unresolved rather than a partial uniqueness claim when over budget',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
        home: Scaffold(body: Text('Too large', key: ValueKey('target')))));
    for (final sampler in [
      RecordingTargetCapture(maxNodes: 1),
      RecordingTargetCapture(maxVisits: 1),
      RecordingTargetCapture(maxDuration: Duration.zero),
    ]) {
      final frozen =
          freeze(tester, sampler, find.byKey(const ValueKey('target')));
      expect(frozen['status'], 'unresolved');
      expect(frozen['candidates'], isEmpty);
      expect(frozen['issue'], contains('budget'));
    }
  });

  testWidgets(
      'records semantics identifiers and never treats text on a different element as the target',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: Scaffold(
            body: Semantics(
      identifier: 'submit-action',
      child: Text('Submit'),
    ))));
    final frozen = freeze(
        tester,
        capture(),
        find.byWidgetPredicate((widget) =>
            widget is Semantics &&
            widget.properties.identifier == 'submit-action'));
    final candidates =
        (frozen['candidates'] as List).cast<Map<String, dynamic>>();
    expect(
        candidates,
        contains(predicate<Map<String, dynamic>>((candidate) =>
            candidate['stability'] == 'semantics' &&
            candidate['matchCount'] == 1 &&
            candidate['matchesTarget'] == true)));
  });
  testWidgets(
      'does not persist editable values in target metadata or selector candidates',
      (tester) async {
    final controller = TextEditingController(text: 'private-prefilled-value');
    await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: TextField(controller: controller))));
    for (final finder in [find.byType(TextField), find.byType(EditableText)]) {
      final frozen = freeze(tester, capture(), finder);
      expect(jsonEncode(frozen), isNot(contains('private-prefilled-value')));
      expect(frozen['text'], isNull);
      expect(frozen['descendantText'], isNull);
      expect((frozen['properties'] as Map?)?['value'], isNull);
    }
    controller.dispose();
  });
}

class _NamedRecordingFixture extends StatelessWidget {
  const _NamedRecordingFixture({required this.onNameRead, required this.child});
  final VoidCallback onNameRead;
  final Widget child;
  String get name {
    onNameRead();
    return 'Unrelated ancestor';
  }

  @override
  Widget build(BuildContext context) => child;
}
