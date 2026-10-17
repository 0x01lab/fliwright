import type { AssertionSuggestion, RecordedOperation, CodegenOptions, ResolvedSelector } from './types.js';
import { DartCodeGenerator } from './DartCodeGenerator.js';
import { serializeSelectorQuery } from './SelectorSerializer.js';
import { prepareRecordingCheckpoints } from './RecordingCheckpoints.js';
import { recordingInputParameters } from './RecordingInputs.js';

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
    const checkpoints = prepareRecordingCheckpoints(options?.checkpoints, operations.length);
    if (checkpoints.issues.length) throw new Error(checkpoints.issues.join('; '));

    const inputParameters = recordingInputParameters(operations);
    const lines: string[] = [];
    const timeline = options?.timeline === true;
    const mode = options?.mode ?? 'test';
    const imports = timeline
      ? `${timelineImports(mode, options)}${checkpoints.executable.length ? ', expect' : ''}`
      : `${mode}, expect${options?.resetToHomeBeforeEach ? ', beforeEach' : ''}`;
    lines.push(`import { ${imports} } from '${escapeString(importSource)}';`);
    lines.push('');

    if (options?.resetToHomeBeforeEach) {
      const homeRoute = options.homeRoute ?? '/';
      lines.push('beforeEach(async ({ page }) => {');
      for (const name of inputParameters.values()) {
        lines.push(`  if (process.env['${name}'] === undefined) throw new Error('Missing recording input parameter: ${name}');`);
      }
      lines.push(`  await page.resetToHome({ homeRoute: '${escapeString(homeRoute)}' });`);
      lines.push('});');
      lines.push('');
    }

    const runner = options?.scenarioName
      ? `${mode}.scenario('${escapeString(options.scenarioName)}')`
      : mode;
    const fixtureArgs = timeline
      ? mode === 'test'
        ? '{ page, flow, mock, assert, agent }'
        : '{ page, flow, mock, agent }'
      : '{ page }';
    lines.push(`${runner}('${escapeString(testName)}', async (${fixtureArgs}) => {`);
    for (const [index, name] of inputParameters) {
      lines.push(`  const recordedInput${index + 1} = process.env['${name}'];`);
      lines.push(`  if (recordedInput${index + 1} === undefined) throw new Error('Missing recording input parameter: ${name}');`);
    }
    const appendCheckpoints = (operationIndex: number): void => {
      for (const checkpoint of checkpoints.executable) {
        if ((checkpoint.afterOperationIndex ?? operations.length - 1) !== operationIndex) continue;
        const locator = `page.locator(${JSON.stringify(checkpoint.query)})`;
        const negate = checkpoint.expected === false ? '.not' : '';
        const argument = typeof checkpoint.expected === 'string' ? JSON.stringify(checkpoint.expected) : '';
        lines.push(`  await expect(${locator}, ${JSON.stringify(checkpoint.reason ?? checkpoint.id)})${negate}.${checkpoint.matcher}(${argument});`);
      }
    };
    appendCheckpoints(-1);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (op.status === 'ignored') {
        appendCheckpoints(i);
        continue;
      }
      const resolved = selectors.get(i);
      const locator = resolved ? `page.locator(${serializeSelectorQuery(resolved.query)})` : undefined;
      const lead = !resolved ? '  // unresolved target: review this coordinate draft\n'
        : resolved.ambiguous ? `  // ambiguous: matched ${resolved.matchCount}, frozen selector requires review\n` : '';
      const action = operationLine(op, locator, inputParameters.has(i) ? `recordedInput${i + 1}` : undefined);
      if (timeline) {
        if (lead) lines.push(lead.trimEnd());
        lines.push(`  await flow.step('${escapeString(stepTitle(op))}', async () => {`);
        lines.push(`    ${action}`);
        lines.push('  });');
        for (const frame of framesForOperation(options?.recordingFrames, i)) {
          lines.push(`  await flow.frame('Recorded frame ${frame.index + 1}', { screenshot: true });`);
        }
        if (mode === 'test') {
          for (const suggestion of suggestionsForOperation(options?.assertionSuggestions, i)) {
            lines.push(`  // ${escapeComment(suggestion.template).replace(/^\/\/\s*/, '')}`);
          }
        }
        appendCheckpoints(i);
        continue;
      }
      lines.push(`${lead}  ${action}`);
      appendCheckpoints(i);
    }

    lines.push('});');
    return lines.join('\n');
  }
}

function framesForOperation(
  frames: readonly { operationIndex?: number; index: number; screenshot?: unknown }[] | undefined,
  operationIndex: number,
) {
  return (frames ?? []).filter((frame) => frame.operationIndex === operationIndex && frame.screenshot != null);
}

function suggestionsForOperation(
  suggestions: readonly AssertionSuggestion[] | undefined,
  operationIndex: number,
) {
  return (suggestions ?? []).filter((suggestion) => suggestion.afterIndex === operationIndex);
}

function timelineImports(mode: 'script' | 'test', options?: CodegenOptions): string {
  const base = mode === 'script' ? 'script' : 'test';
  return options?.resetToHomeBeforeEach ? `${base}, beforeEach` : base;
}

function operationLine(op: RecordedOperation, locator: string | undefined, inputVariable?: string): string {
  const dragOptions = op.durationMs == null ? '' : `, { duration: ${op.durationMs} }`;
  if (!locator) {
    if (op.kind === 'tap') return `await page.clickAt(${op.position.x}, ${op.position.y});`;
    if (op.kind === 'drag' && op.delta) return `await page.dragFrom(${op.position.x}, ${op.position.y}, ${op.delta.x}, ${op.delta.y}${dragOptions});`;
    return `throw new Error(${JSON.stringify(`Unresolved ${op.kind} target; review the recorded target before replay.`)});`;
  }
  switch (op.kind) {
    case 'tap':
      return `await ${locator}.click({ waitForAnimations: true });`;
    case 'longPress':
      return `await ${locator}.longPress({ duration: ${op.durationMs ?? op.duration ?? 0} });`;
    case 'drag':
      return `await ${locator}.drag(${op.delta!.x}, ${op.delta!.y}${dragOptions});`;
    case 'type':
      if (inputVariable) return `await ${locator}.fill(${inputVariable}, { sensitive: true });`;
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

function escapeComment(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/\*\//g, '* /');
}
