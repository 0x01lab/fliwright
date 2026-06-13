import type { RecordedOperation, CodegenOptions } from './types.js';
import { DartCodeGenerator } from './DartCodeGenerator.js';

const DEFAULT_IMPORT = "@fliwright/vitest";
const DEFAULT_TEST_NAME = 'recorded test';

export class CodeGenerator {
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, string>,
    options?: CodegenOptions,
  ): string {
    if (options?.lang === 'dart') {
      return new DartCodeGenerator().generate(operations, selectors, options);
    }

    const importSource = options?.imports ?? DEFAULT_IMPORT;
    const testName = options?.testName ?? DEFAULT_TEST_NAME;

    const lines: string[] = [];
    const imports = options?.resetToHomeBeforeEach ? 'test, expect, beforeEach' : 'test, expect';
    lines.push(`import { ${imports} } from '${escapeString(importSource)}';`);
    lines.push('');

    if (options?.resetToHomeBeforeEach) {
      const homeRoute = options.homeRoute ?? '/';
      lines.push('beforeEach(async ({ page }) => {');
      lines.push(`  await page.navigate('${escapeString(homeRoute)}');`);
      lines.push('});');
      lines.push('');
    }

    lines.push(`test('${escapeString(testName)}', async ({ page }) => {`);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.status === 'ignored') continue;
      const selector = selectors.get(i) ?? "{ type: 'Widget' }";
      const locator = `page.locator(${selector})`;

      switch (op.kind) {
        case 'tap':
          lines.push(`  await ${locator}.click();`);
          break;
        case 'longPress':
          lines.push(`  await ${locator}.longPress({ duration: ${op.duration} });`);
          break;
        case 'drag':
          lines.push(`  await ${locator}.drag(${op.delta!.x}, ${op.delta!.y});`);
          break;
        case 'type':
          if (op.action === 'replace') {
            lines.push(`  await ${locator}.fill('${escapeString(op.text ?? '')}');`);
          } else {
            lines.push(`  await ${locator}.type('${escapeString(op.text ?? '')}');`);
          }
          break;
      }
    }

    lines.push('});');
    return lines.join('\n');
  }
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
