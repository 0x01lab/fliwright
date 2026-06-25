import { describe, expect, it } from 'vitest';
import { generateRedFirstTest, generateRedFirstTestSuite, type InteractionSpec } from '../../src/index.js';

describe('generateRedFirstTest', () => {
  it('generates a red-first Fliwright test from an interaction spec', () => {
    const spec: InteractionSpec = {
      app: { route: '/login', screenName: 'Login' },
      elements: [
        {
          id: 'email',
          role: 'textbox',
          name: 'Email',
          locatorHints: [{ strategy: 'key', value: 'loginEmailField' }],
        },
        {
          id: 'submit',
          role: 'button',
          name: 'Sign in',
          text: 'Sign in',
          locatorHints: [{ strategy: 'text', value: 'Sign in' }],
        },
        {
          id: 'dashboard-title',
          role: 'text',
          name: 'Dashboard',
          text: 'Dashboard',
        },
      ],
      flows: [
        {
          id: 'login',
          name: 'user can sign in',
          steps: [
            { action: 'type', target: 'email', value: 'leo@example.com' },
            { action: 'tap', target: 'submit' },
          ],
          expectedOutcome: [
            { kind: 'visible', target: 'dashboard-title' },
            { kind: 'mockCalled', endpoint: '/auth/login', method: 'POST' },
          ],
        },
      ],
    };

    const result = generateRedFirstTest(spec);

    expect(result.warnings).toEqual([]);
    expect(result.selectorDiagnostics.find((diagnostic) => diagnostic.elementId === 'email')?.status).toBe('hint-only');
    expect(result.testCode).toContain("beforeEach(async ({ page }) => {");
    expect(result.testCode).toContain('await page.resetToHome({ homeRoute: "/login" });');
    expect(result.testCode).toContain('await page.locator({ key: "loginEmailField" }).fill("leo@example.com");');
    expect(result.testCode).toContain('await page.locator({ text: "Sign in" }).click();');
    expect(result.testCode).toContain('await expect(page.locator({ text: "Dashboard" })).toBeVisible();');
    expect(result.testCode).toContain('await mock.waitForCall({ path: "/auth/login", method: "POST" });');
  });

  it('returns selector diagnostics using widget candidates', () => {
    const result = generateRedFirstTest({
      elements: [
        { id: 'save', role: 'button', name: 'Save', text: 'Save' },
      ],
      flows: [{ id: 'save-flow', name: 'save flow', steps: [{ action: 'tap', target: 'save' }] }],
    }, {
      widgets: [
        { text: 'Save', type: 'TextButton' },
        { text: 'Save', type: 'ElevatedButton' },
      ],
    });

    expect(result.selectorDiagnostics[0]).toMatchObject({
      elementId: 'save',
      status: 'ambiguous',
    });
  });

  it('uses stable keys discovered from unique widget candidates in generated locators', () => {
    const result = generateRedFirstTest({
      elements: [
        { id: 'save', role: 'button', name: 'Save', text: 'Save' },
        { id: 'toast', role: 'text', name: 'Saved', text: 'Saved' },
      ],
      flows: [{
        id: 'save-flow',
        name: 'save flow',
        steps: [{ action: 'tap', target: 'save' }],
        expectedOutcome: [{ kind: 'visible', target: 'toast' }],
      }],
    }, {
      widgets: [
        { role: 'button', text: 'Save', key: 'saveButton', type: 'ElevatedButton' },
        { role: 'text', text: 'Saved', semanticsLabel: 'Saved successfully', type: 'Text' },
      ],
    });

    expect(result.selectorDiagnostics.find((diagnostic) => diagnostic.elementId === 'save')).toMatchObject({
      status: 'resolved',
    });
    expect(result.testCode).toContain('await page.locator({ key: "saveButton" }).click();');
    expect(result.testCode).toContain('await expect(page.locator({ semantics: { label: "Saved successfully" } })).toBeVisible();');
  });

  it('throws a precise error when a requested flow id is missing', () => {
    expect(() => generateRedFirstTest({
      elements: [
        { id: 'save', role: 'button', name: 'Save', text: 'Save' },
      ],
      flows: [
        { id: 'save-flow', name: 'save', steps: [{ action: 'tap', target: 'save' }] },
      ],
    }, { flowId: 'missing-flow' })).toThrow("Flow 'missing-flow' was not found in InteractionSpec.flows.");
  });

  it('warns for state assertions that need a custom adapter', () => {
    const result = generateRedFirstTest({
      elements: [{ id: 'cart-count', role: 'text', name: 'Cart count', text: '1 item' }],
      flows: [{
        id: 'stateful',
        name: 'stateful flow',
        steps: [],
        expectedOutcome: [{ kind: 'state', path: 'cart.items.length', equals: 1 }],
      }],
    });

    expect(result.warnings).toEqual([
      "State assertion 'cart.items.length' requires a custom state adapter and was not emitted.",
    ]);
  });

  it('can target a specific flow by id', () => {
    const result = generateRedFirstTest({
      elements: [
        { id: 'save', role: 'button', name: 'Save', text: 'Save' },
        { id: 'cancel', role: 'button', name: 'Cancel', text: 'Cancel' },
      ],
      flows: [
        { id: 'save-flow', name: 'save', steps: [{ action: 'tap', target: 'save' }] },
        { id: 'cancel-flow', name: 'cancel', steps: [{ action: 'tap', target: 'cancel' }] },
      ],
    }, { flowId: 'cancel-flow' });

    expect(result.testName).toBe('cancel');
    expect(result.testCode).toContain('page.locator({ text: "Cancel" }).click()');
    expect(result.testCode).not.toContain('page.locator({ text: "Save" }).click()');
  });

  it('escapes generated string literals safely', () => {
    const result = generateRedFirstTest({
      app: { route: '/quote\nroute' },
      elements: [
        { id: 'input', role: 'textbox', name: 'Input', text: 'Input' },
        { id: 'message', role: 'text', name: 'Message', text: 'He said "hi"\nagain' },
      ],
      flows: [{
        id: 'quote-flow',
        name: 'quote "flow"',
        steps: [{ action: 'type', target: 'input', value: 'line 1\nline 2' }],
        expectedOutcome: [{ kind: 'text', target: 'message', contains: 'said "hi"\nagain' }],
      }],
    });

    expect(result.testCode).toContain('test("quote \\"flow\\""');
    expect(result.testCode).toContain('homeRoute: "/quote\\nroute"');
    expect(result.testCode).toContain('.fill("line 1\\nline 2")');
    expect(result.testCode).toContain('.toContainText("said \\"hi\\"\\nagain")');
  });

  it('generates a red-first suite for every flow in the spec', () => {
    const result = generateRedFirstTestSuite({
      app: { route: '/settings' },
      elements: [
        { id: 'save', role: 'button', name: 'Save', text: 'Save' },
        { id: 'cancel', role: 'button', name: 'Cancel', text: 'Cancel' },
        { id: 'toast', role: 'text', name: 'Saved', text: 'Saved' },
      ],
      flows: [
        {
          id: 'save-flow',
          name: 'save settings',
          steps: [{ action: 'tap', target: 'save' }],
          expectedOutcome: [{ kind: 'visible', target: 'toast' }],
        },
        {
          id: 'cancel-flow',
          name: 'cancel settings',
          steps: [{ action: 'tap', target: 'cancel' }],
          expectedOutcome: [{ kind: 'route', equals: '/home' }],
        },
      ],
    }, { testNamePrefix: 'settings' });

    expect(result.tests.map((test) => test.testName)).toEqual([
      'settings: save settings',
      'settings: cancel settings',
    ]);
    expect(result.testCode.match(/beforeEach\(async/g)).toHaveLength(1);
    expect(result.testCode).toContain('test("settings: save settings"');
    expect(result.testCode).toContain('test("settings: cancel settings"');
    expect(result.testCode).toContain('await page.locator({ text: "Save" }).click();');
    expect(result.testCode).toContain('await expect(await page.currentRoute()).toBe("/home");');
  });
});
