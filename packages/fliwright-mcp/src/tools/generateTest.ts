import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { analyzeInteractionSpecCoverage, generateRedFirstTestSuite, prepareRedFirstWorkflow } from '@fliwright/tdd';
import type { InteractionSpec, WidgetCandidate } from '@fliwright/tdd';
import type { ServerState } from '../state.js';
import type { GenerateTestResult } from '../types.js';

interface ParsedWidget {
  type: 'text' | 'textField' | 'button' | 'appBar';
  text: string;
  hintText?: string;
}

export interface SnapshotRefInput {
  role: string;
  label: string;
  key?: string;
  type?: string;
  selector?: string;
  textField?: boolean;
}

export interface RedFirstGenerateTestParams {
  mode?: 'red-first';
  spec: InteractionSpec;
  flowId?: string;
  allFlows?: boolean;
  flowIds?: string[];
  testNamePrefix?: string;
  snapshot?: string;
  refs?: SnapshotRefInput[];
  testName?: string;
  resetToHomeBeforeEach?: boolean;
  homeRoute?: string;
  outputFile?: string;
}

function parseFlutterSource(source: string): ParsedWidget[] {
  const widgets: ParsedWidget[] = [];

  // Extract AppBar title
  const appBarRegex = /AppBar\([^)]*title:\s*Text\(['"]([^'"]+)['"]\)/;
  const appBarMatch = appBarRegex.exec(source);
  if (appBarMatch) {
    widgets.push({ type: 'appBar', text: appBarMatch[1] });
  }

  // Extract TextField with hintText
  const hintRegex = /TextField\([^)]*hintText:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = hintRegex.exec(source)) !== null) {
    widgets.push({ type: 'textField', text: match[1], hintText: match[1] });
  }

  // Extract TextFormField with hintText or labelText
  const formFieldRegex = /TextFormField\([^)]*(?:hintText|labelText):\s*['"]([^'"]+)['"]/g;
  while ((match = formFieldRegex.exec(source)) !== null) {
    widgets.push({ type: 'textField', text: match[1], hintText: match[1] });
  }

  // Extract ElevatedButton/TextButton child Text
  // Use [\s\S]*? instead of [^)]* to handle nested parens like onPressed: () {}
  const buttonRegex = /(?:ElevatedButton|TextButton|OutlinedButton)\([\s\S]*?child:\s*Text\(['"]([^'"]+)['"]\)/g;
  while ((match = buttonRegex.exec(source)) !== null) {
    widgets.push({ type: 'button', text: match[1] });
  }

  // Extract Text('...') widgets (general)
  const textRegex = /Text\(['"]([^'"]+)['"]\)/g;
  while ((match = textRegex.exec(source)) !== null) {
    widgets.push({ type: 'text', text: match[1] });
  }

  return widgets;
}

function stringLiteral(value: string): string {
  return JSON.stringify(value);
}

function normalizeSnapshotRefs(refs?: SnapshotRefInput[], snapshot?: string): SnapshotRefInput[] {
  if (refs?.length) {
    return refs.filter((ref) => ref.label?.trim());
  }
  if (!snapshot) return [];

  const parsed: SnapshotRefInput[] = [];
  const lineRegex = /-\s+([a-zA-Z][\w-]*)\s+"([^"]+)"\s+\[ref=[^\]]+\]/g;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(snapshot)) !== null) {
    parsed.push({ role: match[1], label: unescapeSnapshotLabel(match[2]) });
  }
  return parsed;
}

function unescapeSnapshotLabel(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function appendSnapshotBasedSteps(lines: string[], refs: SnapshotRefInput[]): void {
  const textFields = refs.filter((ref) => ref.textField || ref.role === 'textbox');
  const buttons = refs.filter((ref) => ref.role === 'button' || ref.role === 'link');
  const visibleText = refs.filter((ref) => ref.role === 'heading' || ref.role === 'text');

  for (const field of textFields.slice(0, 3)) {
    const variable = uniqueVarName('field', field.label, lines);
    lines.push(`  const ${variable} = await page.findRef(${findQueryFor(field)});`);
    lines.push(`  await ${variable}.fill(${stringLiteral('test_input')});`);
  }

  for (const button of buttons.slice(0, 2)) {
    const variable = uniqueVarName('button', button.label, lines);
    lines.push(`  const ${variable} = await page.findRef(${findQueryFor(button)});`);
    lines.push(`  await ${variable}.click();`);
  }

  const assertionTarget = visibleText.at(-1) ?? buttons.at(-1) ?? textFields.at(-1);
  if (assertionTarget) {
    lines.push(`  await expect(page.locator({ text: ${stringLiteral(assertionTarget.label)} })).toBeVisible();`);
  }
}

function appendSourceBasedSteps(lines: string[], widgets: ParsedWidget[]): void {
  const textWidgets = widgets.filter(w => w.type === 'text');
  const buttonWidgets = widgets.filter(w => w.type === 'button');
  const textFieldWidgets = widgets.filter(w => w.type === 'textField');

  for (const field of textFieldWidgets) {
    const selector = `{ text: ${stringLiteral(field.hintText ?? field.text)} }`;
    lines.push(`  await page.locator(${selector}).click();`);
    lines.push(`  await page.locator(${selector}).type(${stringLiteral('test_input')});`);
  }

  for (const btn of buttonWidgets) {
    lines.push(`  await page.locator({ text: ${stringLiteral(btn.text)} }).click();`);
  }

  if (textWidgets.length > 0) {
    const lastText = textWidgets[textWidgets.length - 1];
    lines.push(`  await expect(page.locator({ text: ${stringLiteral(lastText.text)} })).toBeVisible();`);
  }
}

function findQueryFor(ref: SnapshotRefInput): string {
  if (ref.key) return `{ key: ${stringLiteral(ref.key)} }`;
  const parts = [`role: ${stringLiteral(ref.role)}`, `text: ${stringLiteral(ref.label)}`];
  if (ref.type) parts.push(`type: ${stringLiteral(ref.type)}`);
  return `{ ${parts.join(', ')} }`;
}

function uniqueVarName(prefix: string, label: string, existingLines: string[]): string {
  const base = `${prefix}${toPascal(label)}`.slice(0, 40) || prefix;
  let candidate = base;
  let suffix = 2;
  while (existingLines.some((line) => line.includes(`const ${candidate} `))) {
    candidate = `${base}${suffix++}`;
  }
  return candidate;
}

function toPascal(value: string): string {
  const ascii = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  return ascii || 'Target';
}

export async function handleGenerateTest(
  params: {
    mode?: 'default' | 'red-first';
    spec?: InteractionSpec;
    flowId?: string;
    allFlows?: boolean;
    flowIds?: string[];
    testNamePrefix?: string;
    source?: string;
    snapshot?: string;
    refs?: SnapshotRefInput[];
    description?: string;
    testName?: string;
    resetToHomeBeforeEach?: boolean;
    homeRoute?: string;
    outputFile?: string;
  },
  state?: ServerState,
): Promise<GenerateTestResult> {
  if (params.mode === 'red-first') {
    if (!params.spec) throw new Error("mode 'red-first' requires an InteractionSpec in params.spec.");
    return await prepareRedFirstGeneratedTest(params as RedFirstGenerateTestParams, state);
  }

  const testName = params.testName ?? 'generated test';
  const resetToHomeBeforeEach = params.resetToHomeBeforeEach ?? true;
  const homeRoute = params.homeRoute ?? '/';
  const refs = normalizeSnapshotRefs(params.refs, params.snapshot);
  const widgets = refs.length > 0 ? [] : parseFlutterSource(params.source ?? '');

  const lines: string[] = [];
  const imports = resetToHomeBeforeEach ? 'test, expect, beforeEach' : 'test, expect';
  lines.push(`import { ${imports} } from '@fliwright/vitest';`);
  lines.push('');

  if (resetToHomeBeforeEach) {
    lines.push('beforeEach(async ({ page }) => {');
    lines.push(`  await page.resetToHome({ homeRoute: ${stringLiteral(homeRoute)} });`);
    lines.push('});');
    lines.push('');
  }

  lines.push(`test(${stringLiteral(testName)}, async ({ page }) => {`);

  if (refs.length > 0) {
    appendSnapshotBasedSteps(lines, refs);
  } else {
    appendSourceBasedSteps(lines, widgets);
  }
  lines.push('});');

  const output = {
    testCode: lines.join('\n'),
    testName,
  };
  return await persistGeneratedTest(output, params.outputFile);
}

export async function prepareRedFirstGeneratedTest(
  params: RedFirstGenerateTestParams,
  state?: ServerState,
): Promise<GenerateTestResult> {
  const outputFile = params.outputFile ? resolve(params.outputFile) : undefined;
  const refs = normalizeSnapshotRefs(params.refs, params.snapshot);
  if (params.allFlows) {
    const coverage = analyzeInteractionSpecCoverage(params.spec);
    const result = generateRedFirstTestSuite(params.spec, {
      flowIds: params.flowIds,
      testNamePrefix: params.testNamePrefix,
      homeRoute: params.homeRoute,
      resetToHomeBeforeEach: params.resetToHomeBeforeEach,
      widgets: snapshotRefsToWidgetCandidates(refs),
    });
    const output = {
      testCode: result.testCode,
      testName: params.testName ?? params.testNamePrefix ?? 'red-first suite',
      testFile: outputFile,
      warnings: result.warnings,
      selectorDiagnostics: result.selectorDiagnostics,
      tests: result.tests,
      coverage,
    };
    const persisted = await persistGeneratedTest(output, outputFile);
    state?.setTddWorkflowContext({
      testFile: persisted.testFile,
      selectorDiagnostics: result.selectorDiagnostics,
      tests: result.tests,
      coverage,
    });
    return persisted;
  }

  const result = prepareRedFirstWorkflow(params.spec, {
    flowId: params.flowId,
    testName: params.testName,
    homeRoute: params.homeRoute,
    resetToHomeBeforeEach: params.resetToHomeBeforeEach,
    widgets: snapshotRefsToWidgetCandidates(refs),
    testFile: outputFile,
  });
  const output = {
    testCode: result.testCode,
    testName: result.testName,
    testFile: outputFile,
    warnings: result.warnings,
    selectorDiagnostics: result.selectorDiagnostics,
    workflow: result.workflow,
    coverage: result.workflow.coverage,
  };
  const persisted = await persistGeneratedTest(output, outputFile);
  state?.setTddWorkflowContext({
    testName: result.testName,
    flowId: result.flowId,
    testFile: persisted.testFile,
    selectorDiagnostics: result.selectorDiagnostics,
    coverage: result.workflow.coverage,
    workflow: result.workflow,
  });
  return persisted;
}

function snapshotRefsToWidgetCandidates(refs: SnapshotRefInput[]): WidgetCandidate[] {
  return refs.map((ref) => ({
    key: ref.key,
    text: ref.label,
    type: ref.type,
    role: ref.role,
  }));
}

export const GenerateTestParamsSchema = z.object({
  mode: z.enum(['default', 'red-first']).optional().default('default')
    .describe("Generation mode. Use 'red-first' with spec for TDD-oriented tests."),
  spec: z.object({
    app: z.any().optional(),
    initialState: z.any().optional(),
    elements: z.array(z.any()),
    flows: z.array(z.any()),
    assertions: z.array(z.any()).optional(),
  }).passthrough().optional().describe('InteractionSpec from design/intention parsing for red-first TDD generation'),
  flowId: z.string().optional().describe('Flow id to generate when mode is red-first and spec contains multiple flows'),
  allFlows: z.boolean().optional().default(false)
    .describe('Generate one red-first test for every selected flow in the InteractionSpec'),
  flowIds: z.array(z.string()).optional()
    .describe('Subset of flow ids to generate when allFlows is true'),
  testNamePrefix: z.string().optional()
    .describe('Prefix to apply to generated suite test names when allFlows is true'),
  source: z.string().optional().describe('Flutter/Dart source code of the page or widget to test'),
  snapshot: z.string().optional().describe('Agent-readable snapshot text from fliwright_snap'),
  refs: z.array(z.object({
    role: z.string(),
    label: z.string(),
    key: z.string().optional(),
    type: z.string().optional(),
    selector: z.string().optional(),
    textField: z.boolean().optional(),
  })).optional().describe('Structured refs from fliwright_snap'),
  description: z.string().optional().describe('Natural language description of what the test should verify'),
  testName: z.string().optional().describe('Name for the generated test'),
  resetToHomeBeforeEach: z.boolean().optional().default(true)
    .describe('Whether to generate a beforeEach hook that navigates to the home route before each test'),
  homeRoute: z.string().optional().default('/')
    .describe('Route used by the generated beforeEach home reset hook'),
  outputFile: z.string().optional().describe('Optional path to write the generated test file'),
});

export function registerGenerateTestTool(server: McpServer, _state: ServerState): void {
  server.tool(
    'fliwright_generate_test',
    'Generate a Fliwright test script from an InteractionSpec, source snippet, or agent snapshot',
    GenerateTestParamsSchema.shape,
    async (params) => {
      const result = await handleGenerateTest(params, _state);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}

async function persistGeneratedTest(result: GenerateTestResult, outputFile: string | undefined): Promise<GenerateTestResult> {
  if (!outputFile) return result;
  const absolutePath = resolve(outputFile);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, result.testCode, 'utf8');
  return {
    ...result,
    testFile: absolutePath,
  };
}
