import type { RecordedOperation, CodegenOptions } from './types.js';

const DEFAULT_TEST_NAME = 'recorded test';

export class DartCodeGenerator {
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, string>,
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
      const selector = selectors.get(i) ?? "{ type: 'Widget' }";
      const finder = dartFinder(selector);

      switch (op.kind) {
        case 'tap':
          lines.push(`    await tester.tap(${finder});`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'longPress':
          lines.push(`    await tester.longPress(${finder});`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'drag':
          lines.push(`    await tester.drag(${finder}, const Offset(${op.delta!.x}, ${op.delta!.y}));`);
          lines.push('    await tester.pumpAndSettle();');
          break;
        case 'type':
          lines.push(`    await tester.enterText(${finder}, '${escapeString(op.text ?? '')}');`);
          lines.push('    await tester.pumpAndSettle();');
          break;
      }
    }

    lines.push('  });');
    lines.push('}');
    return lines.join('\n');
  }
}

function dartFinder(selector: string): string {
  if (selector.includes('text:')) {
    const match = selector.match(/text:\s*'([^']*)'/);
    if (match) return `find.text('${match[1]}')`;
  }
  if (selector.includes('key:')) {
    const match = selector.match(/key:\s*'([^']*)'/);
    if (match) return `find.byKey(const Key('${match[1]}'))`;
  }
  if (selector.includes('type:')) {
    const match = selector.match(/type:\s*'([^']*)'/);
    if (match) return `find.byType(${match[1]})`;
  }
  return 'find.byType(Widget)';
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
