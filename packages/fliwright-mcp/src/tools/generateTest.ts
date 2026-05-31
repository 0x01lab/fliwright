import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';
import type { GenerateTestResult } from '../types.js';

interface ParsedWidget {
  type: 'text' | 'textField' | 'button' | 'appBar';
  text: string;
  hintText?: string;
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

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function handleGenerateTest(
  params: { source: string; description?: string; testName?: string },
): GenerateTestResult {
  const testName = params.testName ?? 'generated test';
  const widgets = parseFlutterSource(params.source);

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@fliwright/vitest';`);
  lines.push('');
  lines.push(`test('${escapeStr(testName)}', async ({ page }) => {`);

  const textWidgets = widgets.filter(w => w.type === 'text');
  const buttonWidgets = widgets.filter(w => w.type === 'button');
  const textFieldWidgets = widgets.filter(w => w.type === 'textField');

  // Generate type operations for TextFields
  for (const field of textFieldWidgets) {
    const selector = `{ text: '${escapeStr(field.hintText ?? field.text)}' }`;
    lines.push(`  await page.locator(${selector}).click();`);
    lines.push(`  await page.locator(${selector}).type('test_input');`);
  }

  // Generate click operations for buttons
  for (const btn of buttonWidgets) {
    lines.push(`  await page.locator({ text: '${escapeStr(btn.text)}' }).click();`);
  }

  // Generate visibility assertion for the last text widget (likely confirmation)
  if (textWidgets.length > 0) {
    const lastText = textWidgets[textWidgets.length - 1];
    lines.push(`  await expect(page.locator({ text: '${escapeStr(lastText.text)}' })).toBeVisible();`);
  }

  lines.push('});');

  return {
    testCode: lines.join('\n'),
    testName,
  };
}

export const GenerateTestParamsSchema = z.object({
  source: z.string().describe('Flutter/Dart source code of the page or widget to test'),
  description: z.string().optional().describe('Natural language description of what the test should verify'),
  testName: z.string().optional().describe('Name for the generated test'),
});

export function registerGenerateTestTool(server: McpServer, _state: ServerState): void {
  server.tool(
    'fliwright_generate_test',
    'Generate a Fliwright test script from Flutter source code',
    GenerateTestParamsSchema.shape,
    async (params) => {
      const result = handleGenerateTest(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
