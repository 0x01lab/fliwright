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
    const timeline = options?.timeline === true;
    const mode = options?.mode ?? 'test';
    const imports = timeline
      ? timelineImports(mode, options)
      : (options?.resetToHomeBeforeEach ? 'test, expect, beforeEach' : 'test, expect');
    lines.push(`import { ${imports} } from '${escapeString(importSource)}';`);
    lines.push('');

    if (options?.resetToHomeBeforeEach) {
      const homeRoute = options.homeRoute ?? '/';
      lines.push('beforeEach(async ({ page }) => {');
      lines.push(`  await page.resetToHome({ homeRoute: '${escapeString(homeRoute)}' });`);
      lines.push('});');
      lines.push('');
    }

    const runner = timeline && mode === 'script' ? 'script' : 'test';
    const fixtureArgs = timeline
      ? '{ page, flow, mock, agent }'
      : '{ page }';
    lines.push(`${runner}('${escapeString(testName)}', async (${fixtureArgs}) => {`);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.status === 'ignored') continue;
      const resolved = selectors.get(i) ?? { query: { match: { type: 'Widget' } }, ambiguous: true, matchCount: 0 };
      const locator = `page.locator(${serializeSelectorQuery(resolved.query)})`;
      const lead = resolved.ambiguous ? `  // ambiguous: matched ${resolved.matchCount}, positional fallback\n` : '';
      const action = operationLine(op, locator);
      if (timeline) {
        if (lead) lines.push(lead.trimEnd());
        lines.push(`  await flow.step('${escapeString(stepTitle(op))}', async () => {`);
        lines.push(`    ${action}`);
        lines.push('  });');
        continue;
      }

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

function timelineImports(mode: 'script' | 'test', options?: CodegenOptions): string {
  const base = mode === 'script' ? 'script' : 'test';
  return options?.resetToHomeBeforeEach ? `${base}, beforeEach` : base;
}

function operationLine(op: RecordedOperation, locator: string): string {
  switch (op.kind) {
    case 'tap':
      return `await ${locator}.click();`;
    case 'longPress':
      return `await ${locator}.longPress({ duration: ${op.duration} });`;
    case 'drag':
      return `await ${locator}.drag(${op.delta!.x}, ${op.delta!.y});`;
    case 'type':
      return op.action === 'replace'
        ? `await ${locator}.fill('${escapeString(op.text ?? '')}');`
        : `await ${locator}.type('${escapeString(op.text ?? '')}');`;
  }
}

function stepTitle(op: RecordedOperation): string {
  switch (op.kind) {
    case 'tap':
      return 'Tap target';
    case 'longPress':
      return 'Long press target';
    case 'drag':
      return 'Drag target';
    case 'type':
      return op.action === 'replace' ? 'Fill text' : 'Type text';
  }
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
