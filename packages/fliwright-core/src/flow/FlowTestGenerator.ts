import type { FliwrightFlowDocument, FliwrightFlowNode } from './types.js';

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
  const lines: string[] = [];

  lines.push(`import { ${options.resetToHomeBeforeEach ? 'test, expect, beforeEach' : 'test, expect'} } from '${escapeString(importSource)}';`);
  lines.push('');
  if (options.resetToHomeBeforeEach) {
    lines.push('beforeEach(async ({ page }) => {');
    lines.push(`  await page.resetToHome({ homeRoute: '${escapeString(options.homeRoute ?? '/')}' });`);
    lines.push('});');
    lines.push('');
  }

  lines.push(`test('${escapeString(testName)}', async ({ page${useFlowSteps ? ', flow' : ''} }) => {`);
  for (const node of flow.nodes) {
    const body = nodeLines(node);
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

function nodeLines(node: FliwrightFlowNode): string[] {
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
    lines.push(operationLine(node, `page.locator('${escapeString(node.selector)}')`));
    return lines;
  }
  if (node.selector) {
    lines.push(`await expect(page.locator('${escapeString(node.selector)}')).toBeVisible();`);
  }
  return lines;
}

function operationLine(node: FliwrightFlowNode, locator: string): string {
  const operation = node.operation!;
  switch (operation.kind) {
    case 'tap':
      return `await ${locator}.click();`;
    case 'longPress':
      return `await ${locator}.longPress({ duration: ${operation.duration ?? 500} });`;
    case 'drag':
      return `await ${locator}.drag(${operation.delta?.x ?? 0}, ${operation.delta?.y ?? 0});`;
    case 'type':
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
