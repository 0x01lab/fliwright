import type { RecordedOperation, CodegenOptions, ResolvedSelector, SelectorQuery } from './types.js';

const DEFAULT_TEST_NAME = 'recorded test';

export class DartCodeGenerator {
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, ResolvedSelector>,
    options?: CodegenOptions,
  ): string {
    const testName = options?.testName ?? DEFAULT_TEST_NAME;

    const lines: string[] = [];
    lines.push("import 'package:flutter_test/flutter_test.dart';");
    lines.push("import 'package:integration_test/integration_test.dart';");
    lines.push('');
    lines.push('void main() {');
    lines.push('  IntegrationTestWidgetsFlutterBinding.ensureInitialized();');
    lines.push('');
    lines.push(`  testWidgets('${escapeString(testName)}', (WidgetTester tester) async {`);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.status === 'ignored') continue;
      const resolved = selectors.get(i) ?? { query: { match: { type: 'Widget' } }, ambiguous: true, matchCount: 0 };
      const finder = dartFinder(resolved.query);
      const lead = resolved.ambiguous ? `    // ambiguous: matched ${resolved.matchCount}, positional fallback\n` : '';

      switch (op.kind) {
        case 'tap':
          lines.push(`${lead}    await tester.tap(${finder});`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'longPress':
          lines.push(`${lead}    await tester.longPress(${finder});`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'drag':
          lines.push(`${lead}    await tester.drag(${finder}, const Offset(${op.delta!.x}, ${op.delta!.y}));`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'type':
          lines.push(`${lead}    await tester.enterText(${finder}, '${escapeString(op.text ?? '')}');`);
          lines.push('    await tester.pumpAndSettle();');
          break;
      }
    }

    lines.push('  });');
    lines.push('}');
    return lines.join('\n');
  }
}

function dartFinder(query: SelectorQuery): string {
  const base = matchFinder(query.match);
  const scoped = query.containing
    ? `find.ancestor(of: ${dartFinder(query.containing)}, matching: ${base})`
    : query.within
      ? `find.descendant(of: ${dartFinder(query.within)}, matching: ${base})`
      : base;
  if (query.position?.last) return `${scoped}.last`;
  if (query.position?.nth != null) return `${scoped}.at(${query.position.nth})`;
  return scoped;
}

function matchFinder(match?: SelectorQuery['match']): string {
  if (!match) return 'find.byType(Widget)';
  if (match.text) return `find.text('${escapeString(match.text)}')`;
  if (match.key) return `find.byKey(const Key('${escapeString(match.key)}'))`;
  if (match.tooltip) return `find.byTooltip('${escapeString(match.tooltip)}')`;
  if (match.semanticsLabel) return `find.bySemanticsLabel('${escapeString(match.semanticsLabel)}')`;
  if (match.semanticsHint) return `find.bySemanticsLabel('${escapeString(match.semanticsHint)}')`;
  if (match.role) return `find.bySemanticsLabel('${escapeString(match.role)}')`;
  if (match.name) return `find.byKey(const Key('${escapeString(match.name)}'))`;
  if (match.ancestorKey) return `find.byKey(const Key('${escapeString(match.ancestorKey)}'))`;
  if (match.iconCodePoint != null) {
    return `find.byIcon(${match.iconCodePoint})`;
  }
  if (match.type) return `find.byType(${match.type})`;
  return 'find.byType(Widget)';
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
