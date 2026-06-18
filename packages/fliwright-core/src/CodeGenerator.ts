import type { RecordedOperation, CodegenOptions, ResolvedSelector } from './types.js';
import { DartCodeGenerator } from './DartCodeGenerator.js';
import { serializeSelectorQuery } from './SelectorSerializer.js';

const DEFAULT_IMPORT = "@fliwright/vitest";
const DEFAULT_TEST_NAME = 'recorded test';

export class CodeGenerator {
  generate(
    operations: RecordedOperation[],
    selectors: Map<number, ResolvedSelector>,
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
      lines.push(`  await page.resetToHome({ homeRoute: '${escapeString(homeRoute)}' });`);
      lines.push('});');
      lines.push('');
    }

    lines.push(`test('${escapeString(testName)}', async ({ page }) => {`);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.status === 'ignored') continue;
      const resolved = selectors.get(i) ?? { query: { match: { type: 'Widget' } }, ambiguous: true, matchCount: 0 };
      const locator = `page.locator(${serializeSelectorQuery(resolved.query)})`;
      const lead = resolved.ambiguous ? `  // ambiguous: matched ${resolved.matchCount}, positional fallback\n` : '';

      switch (op.kind) {
        case 'tap':
          lines.push(`${lead}  await ${locator}.click();`);
          break;
        case 'longPress':
          lines.push(`${lead}  await ${locator}.longPress({ duration: ${op.duration} });`);
          break;
        case 'drag':
          lines.push(`${lead}  await ${locator}.drag(${op.delta!.x}, ${op.delta!.y});`);
          break;
        case 'type':
          if (op.action === 'replace') {
            lines.push(`${lead}  await ${locator}.fill('${escapeString(op.text ?? '')}');`);
          } else {
            lines.push(`${lead}  await ${locator}.type('${escapeString(op.text ?? '')}');`);
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
