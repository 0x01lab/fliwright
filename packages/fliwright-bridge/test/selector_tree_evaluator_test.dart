import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/src/selector_tree_evaluator.dart';

void main() {
  testWidgets('containing stops walking a subtree after its first leaf match',
      (tester) async {
    await tester.pumpWidget(Directionality(
        textDirection: TextDirection.ltr,
        child: Column(key: const Key('scope'), children: [
          const SizedBox(key: Key('needle')),
          for (var i = 0; i < 200; i++) SizedBox(key: Key('other-$i')),
        ])));
    var descendantChecks = 0;
    final evaluator = SelectorTreeEvaluator(
      matchesLeaf: (element, selector) {
        if (selector.stringValue('value') == 'needle') descendantChecks++;
        return element.widget.key ==
            ValueKey<String>(selector.stringValue('value')!);
      },
      passesFilter: (_, __) => true,
    );
    final result = evaluator.evaluate(
        tester.element(find.byKey(const Key('scope'))),
        ParsedSelectorAst({
          'kind': 'containing',
          'parent': {'kind': 'key', 'value': 'scope'},
          'descendant': {'kind': 'key', 'value': 'needle'},
        }));
    expect(result, hasLength(1));
    expect(descendantChecks, lessThan(5),
        reason: 'Existence checks must stop at the first match.');
  });
}
