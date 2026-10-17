import type { FliwrightFlowDocument, FliwrightFlowNode } from './types.js';
import { recordingInputParameterName } from '../RecordingInputs.js';

export interface FlowTestGeneratorOptions {
  testName?: string;
  imports?: string;
  resetToHomeBeforeEach?: boolean;
  homeRoute?: string;
  useFlowSteps?: boolean;
}

const DEFAULT_IMPORT = '@fliwright/vitest';

export function generateFlowTestSkeleton(
  flow: FliwrightFlowDocument,
  options: FlowTestGeneratorOptions = {},
): string {
  const importSource = options.imports ?? DEFAULT_IMPORT;
  const testName = options.testName ?? flow.title ?? flow.id;
  const useFlowSteps = options.useFlowSteps ?? true;
  const parameters = new Map(flow.nodes.flatMap((node, index) => {
    if (!node.selector || node.operation?.kind !== 'type' || !node.operation.sensitive || node.operation.status === 'ignored') return [];
    const operationIndex = Number.isSafeInteger(node.operationIndex) && node.operationIndex! >= 0 ? node.operationIndex! : index;
    return [[node, { name: recordingInputParameterName(operationIndex), variable: `recordedInput${index + 1}` }] as const];
  }));
  const lines: string[] = [];

  lines.push(`import { ${options.resetToHomeBeforeEach ? 'test, expect, beforeEach' : 'test, expect'} } from '${escapeString(importSource)}';`);
  lines.push('');
  if (options.resetToHomeBeforeEach) {
    lines.push('beforeEach(async ({ page }) => {');
    for (const { name } of parameters.values()) {
      lines.push(`  if (process.env['${name}'] === undefined) throw new Error('Missing recording input parameter: ${name}');`);
    }
    lines.push(`  await page.resetToHome({ homeRoute: '${escapeString(options.homeRoute ?? '/')}' });`);
    lines.push('});');
    lines.push('');
  }

  lines.push(`test('${escapeString(testName)}', async ({ page${useFlowSteps ? ', flow' : ''} }) => {`);
  for (const { name, variable } of parameters.values()) {
    lines.push(`  const ${variable} = process.env['${name}'];`);
    lines.push(`  if (${variable} === undefined) throw new Error('Missing recording input parameter: ${name}');`);
  }
  for (const node of flow.nodes) {
    const body = nodeLines(node, parameters.get(node)?.variable);
    if (body.length === 0) continue;
    if (useFlowSteps) {
      lines.push(`  await flow.step('${escapeString(node.title)}', async () => {`);
      for (const line of body) lines.push(`    ${line}`);
      lines.push('  });');
      continue;
    }
    lines.push(`  // ${node.type}: ${node.title}`);
    for (const line of body) lines.push(`  ${line}`);
  }
  lines.push('});');
  return lines.join('\n');
}

function nodeLines(node: FliwrightFlowNode, inputVariable?: string): string[] {
  if (node.operation?.status === 'ignored') return [];
  const lines: string[] = [];
  if (node.figma) {
    lines.push(`// Figma ${escapeString(node.figma.fileKey || 'unbound')} ${escapeString(node.figma.nodeId || 'unbound')}${node.figma.url ? ` ${escapeString(node.figma.url)}` : ''}`);
  }
  if (node.decisionRules?.length) {
    lines.push('// Decision rules');
    for (const rule of node.decisionRules) {
      lines.push(`// - ${escapeString(rule.label ? `${rule.label}: ${rule.when}` : rule.when)}${rule.target ? ` -> ${escapeString(rule.target)}` : ''}`);
    }
  }
  if (node.notes) lines.push(`// ${escapeString(node.notes)}`);
  if (node.route) lines.push(`await page.goto('${escapeString(node.route)}');`);
  if (node.selector && node.operation) {
    lines.push(operationLine(node, `page.locator('${escapeString(node.selector)}')`, inputVariable));
    return lines;
  }
  if (node.selector) {
    lines.push(`await expect(page.locator('${escapeString(node.selector)}')).toBeVisible();`);
  }
  return lines;
}

function operationLine(node: FliwrightFlowNode, locator: string, inputVariable?: string): string {
  const operation = node.operation!;
  switch (operation.kind) {
    case 'tap':
      return `await ${locator}.click();`;
    case 'longPress':
      return `await ${locator}.longPress({ duration: ${operation.durationMs ?? operation.duration ?? 500} });`;
    case 'drag':
      return `await ${locator}.drag(${operation.delta?.x ?? 0}, ${operation.delta?.y ?? 0}${operation.durationMs == null ? '' : `, { duration: ${operation.durationMs} }`});`;
    case 'type':
      if (inputVariable) return `await ${locator}.fill(${inputVariable}, { sensitive: true });`;
      return operation.action === 'replace'
        ? `await ${locator}.fill('${escapeString(operation.text ?? '')}');`
        : `await ${locator}.type('${escapeString(operation.text ?? '')}');`;
  }
}

function escapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
