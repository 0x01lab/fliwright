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
      if (op.status === 'ignored') continue;
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
  // Extract the first key-value pair from selector like { text: 'value' }
  const textMatch = extractSelectorValue(selector, 'text');
  if (textMatch !== null) return `find.text('${textMatch}')`;

  const keyMatch = extractSelectorValue(selector, 'key');
  if (keyMatch !== null) return `find.byKey(const Key('${keyMatch}'))`;

  const roleMatch = extractSelectorValue(selector, 'role');
  if (roleMatch !== null) return `find.bySemanticsLabel('${roleMatch}')`;

  const typeMatch = extractSelectorValue(selector, 'type');
  if (typeMatch !== null) return `find.byType(${typeMatch})`;

  return 'find.byType(Widget)';
}

function extractSelectorValue(selector: string, key: string): string | null {
  // Match key: 'value' where value can contain escaped quotes (\' or \\)
  const regex = new RegExp(`${key}:\\s*'((?:[^'\\\\]|\\\\.)*)'`);
  const match = selector.match(regex);
  if (!match) return null;
  // Unescape the value for Dart output
  return match[1]
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
