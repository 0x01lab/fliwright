import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
export interface GenerateTestResult {
  testCode: string;
  testName: string;
  testFile?: string;
}

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

export async function generateTestCommand(
  params: {
    source?: string;
    snapshot?: string;
    refs?: SnapshotRefInput[];
    description?: string;
    testName?: string;
    resetToHomeBeforeEach?: boolean;
    homeRoute?: string;
    outputFile?: string;
  },
): Promise<GenerateTestResult> {
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
