import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { generateTestCommand as handleGenerateTest } from '../src/commands/generate-test.js';

describe('handleGenerateTest', () => {
  it('generates test code from Flutter source with Text widgets', async () => {
    const source = `
      Column(
        children: [
          Text('用户名'),
          TextField(decoration: InputDecoration(hintText: '请输入用户名')),
          Text('密码'),
          TextField(decoration: InputDecoration(hintText: '请输入密码')),
          ElevatedButton(onPressed: () {}, child: Text('登录')),
        ],
      )
    `;
    const result = await handleGenerateTest({ source, testName: 'login flow' });
    expect(result.testName).toBe('login flow');
    expect(result.testCode).toContain('test("login flow"');
    expect(result.testCode).toContain("page.locator");
    expect(result.testCode).toContain("请输入用户名");
    expect(result.testCode).toContain("请输入密码");
    expect(result.testCode).toContain("登录");
  });

  it('generates type operations for TextField widgets', async () => {
    const source = `
      TextField(decoration: InputDecoration(hintText: '邮箱'))
    `;
    const result = await handleGenerateTest({ source });
    expect(result.testCode).toContain('.type(');
  });

  it('generates click operations for button widgets', async () => {
    const source = `
      ElevatedButton(onPressed: () {}, child: Text('Submit'))
    `;
    const result = await handleGenerateTest({ source });
    expect(result.testCode).toContain('.click()');
    expect(result.testCode).toContain('Submit');
  });

  it('uses default test name when not provided', async () => {
    const result = await handleGenerateTest({ source: "Text('Hello')" });
    expect(result.testName).toBe('generated test');
    expect(result.testCode).toContain('test("generated test"');
  });

  it('handles source with TextFormField', async () => {
    const source = `
      TextFormField(decoration: InputDecoration(labelText: '姓名'))
    `;
    const result = await handleGenerateTest({ source });
    expect(result.testCode).toContain('.type(');
    expect(result.testCode).toContain('姓名');
  });

  it('generates import statement', async () => {
    const result = await handleGenerateTest({ source: "Text('test')" });
    expect(result.testCode).toContain("import { test, expect, beforeEach } from '@fliwright/vitest'");
  });

  it('generates a beforeEach home reset hook by default', async () => {
    const result = await handleGenerateTest({ source: "Text('test')" });
    expect(result.testCode).toContain("beforeEach(async ({ page }) => {");
    expect(result.testCode).toContain('await page.resetToHome({ homeRoute: "/" })');
  });

  it('supports custom home route and disabling home reset', async () => {
    const custom = await handleGenerateTest({ source: "Text('test')", homeRoute: "/dashboard" });
    expect(custom.testCode).toContain('await page.resetToHome({ homeRoute: "/dashboard" })');

    const disabled = await handleGenerateTest({ source: "Text('test')", resetToHomeBeforeEach: false });
    expect(disabled.testCode).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(disabled.testCode).not.toContain('beforeEach(');
  });

  it('handles empty source gracefully', async () => {
    const result = await handleGenerateTest({ source: '' });
    expect(result.testCode).toContain('test("generated test"');
    expect(result.testCode).toBeDefined();
  });

  it('adds toBeVisible assertion for text that looks like titles', async () => {
    const source = `
      Scaffold(
        appBar: AppBar(title: Text('我的应用')),
        body: Column(children: [
          Text('欢迎回来'),
          ElevatedButton(onPressed: () {}, child: Text('确定')),
        ]),
      )
    `;
    const result = await handleGenerateTest({ source });
    expect(result.testCode).toContain('toBeVisible');
  });

  it('generates ref-discovery steps from structured snapshot refs', async () => {
    const result = await handleGenerateTest({
      refs: [
        { role: "textbox", label: 'Email', type: "TextField", textField: true },
        { role: "button", label: 'Sign in', type: "ElevatedButton" },
        { role: 'text', label: 'Dashboard' },
      ],
      testName: 'snapshot login',
    });

    expect(result.testCode).toContain('const fieldEmail = await page.findRef({ role: "textbox", text: "Email", type: "TextField" })');
    expect(result.testCode).toContain('await fieldEmail.fill("test_input")');
    expect(result.testCode).toContain('const buttonSignIn = await page.findRef({ role: "button", text: "Sign in", type: "ElevatedButton" })');
    expect(result.testCode).toContain('await buttonSignIn.click()');
    expect(result.testCode).toContain('page.locator({ text: "Dashboard" })');
  });

  it('parses agent snapshot text when structured refs are not provided', async () => {
    const result = await handleGenerateTest({
      snapshot: '- textbox "Phone" [ref=e1]\n- button "Continue" [ref=e2]\n',
      resetToHomeBeforeEach: false,
    });

    expect(result.testCode).toContain('page.findRef({ role: "textbox", text: "Phone" })');
    expect(result.testCode).toContain('page.findRef({ role: "button", text: "Continue" })');
    expect(result.testCode).not.toContain('ref=e1');
  });

  it('writes generated test code when outputFile is provided', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'fliwright-generate-test-'));
    const outputFile = resolve(dir, 'generated.test.ts');

    const result = await handleGenerateTest({
      source: "Text('Hello')",
      outputFile,
    });

    expect(result.testFile).toBe(outputFile);
    expect(await readFile(outputFile, 'utf8')).toBe(result.testCode);
  });

  it('escapes generated strings safely', async () => {
    const result = await handleGenerateTest({
      refs: [{ role: 'text', label: 'He said "hi"\nagain' }],
      testName: 'quote "flow"',
      homeRoute: '/quote\nroute',
    });

    expect(result.testCode).toContain('test("quote \\"flow\\""');
    expect(result.testCode).toContain('homeRoute: "/quote\\nroute"');
    expect(result.testCode).toContain('text: "He said \\"hi\\"\\nagain"');
  });
});
