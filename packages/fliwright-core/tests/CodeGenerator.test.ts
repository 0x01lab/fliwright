// packages/fliwright-core/tests/CodeGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../src/CodeGenerator.js';

describe('recording automation kind', () => {
  it('binds generated tests to the named scenario so replay applies its environment', () => {
    const code = new CodeGenerator().generate([], new Map(), { mode: 'test', scenarioName: 'saved-form' });
    expect(code).toContain("test.scenario('saved-form')('recorded test'");
  });

  it('generates a script fixture when script mode is requested without flow wrappers', () => {
    const code = new CodeGenerator().generate([], new Map(), { mode: 'script', testName: 'task' });
    expect(code).toContain("import { script, expect } from '@fliwright/vitest'");
    expect(code).toContain("script('task', async ({ page }) => {");
    expect(code).not.toContain("test('task'");
  });
});
import type { RecordedOperation, RecordingFrame, ResolvedSelector } from '../src/types.js';

function tap(x: number, y: number, ts: number): RecordedOperation {
  return { kind: 'tap', position: { x, y }, timestamp: ts };
}

function typeOp(x: number, y: number, text: string, ts: number): RecordedOperation {
  return { kind: 'type', position: { x, y }, text, timestamp: ts };
}

function longPress(x: number, y: number, duration: number, ts: number): RecordedOperation {
  return { kind: 'longPress', position: { x, y }, duration, timestamp: ts };
}

function drag(x: number, y: number, dx: number, dy: number, ts: number): RecordedOperation {
  return { kind: 'drag', position: { x, y }, delta: { x: dx, y: dy }, timestamp: ts };
}

/** Build a single-entry ResolvedSelector map keyed at index 0 unless overridden. */
function sel(entries: Record<number, ResolvedSelector['query']>): Map<number, ResolvedSelector> {
  const map = new Map<number, ResolvedSelector>();
  for (const [k, query] of Object.entries(entries)) {
    map.set(Number(k), { query, ambiguous: false, matchCount: 1 });
  }
  return map;
}

describe('CodeGenerator', () => {
  it.each([false, true])('waits for a recorded navigation tap before entering the next page (timeline: %s)', async (timeline) => {
    const code = new CodeGenerator().generate([
      tap(10, 20, 1), { ...typeOp(10, 40, 'saved value', 2), action: 'replace' },
    ], sel({ 0: { match: { key: 'open_form' } }, 1: { match: { key: 'form_input' } } }), { mode: 'script', timeline });
    let body!: (fixtures: unknown) => Promise<void>;
    let formReady = false;
    const entered: string[] = [];
    new Function('script', code.replace(/^import .*;\n/, ''))((_: string, callback: typeof body) => { body = callback; });
    await body({
      page: { locator: () => ({
        click: async (options?: { waitForAnimations?: boolean }) => { formReady = options?.waitForAnimations === true; },
        fill: async (value: string) => {
          if (!formReady) throw new Error('The recorded form has not rendered yet');
          entered.push(value);
        },
      }) },
      flow: { step: async (_: string, action: () => Promise<void>) => action() },
    });
    expect(entered).toEqual(['saved value']);
  });

  it('generates a complete test file with imports', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = sel({ 0: { match: { text: 'Login' } } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("test('recorded test'");
    expect(code).toContain("page.locator({ text: 'Login' }).click({ waitForAnimations: true })");
  });

  it('generates type operations', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [typeOp(100, 200, 'alice@test.com', 1000)];
    const selectors = sel({ 0: { match: { text: 'Email' } } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Email' }).type('alice@test.com')");
  });

  it('generates longPress operations with duration', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [longPress(100, 200, 500, 1000)];
    const selectors = sel({ 0: { match: { text: 'Card' } } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Card' }).longPress({ duration: 500 })");
  });

  it('generates drag operations with delta', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [drag(100, 200, 50, -30, 1000)];
    const selectors = sel({ 0: { match: { text: 'Slider' } } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Slider' }).drag(50, -30)");
  });

  it('uses custom test name', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = sel({ 0: { match: { text: 'Btn' } } });
    const code = gen.generate(ops, selectors, { testName: 'login flow' });
    expect(code).toContain("test('login flow'");
  });

  it('generates a beforeEach home reset hook when requested', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = sel({ 0: { match: { text: 'Start' } } });
    const code = gen.generate(ops, selectors, {
      resetToHomeBeforeEach: true,
      homeRoute: '/home',
    });
    expect(code).toContain("import { test, expect, beforeEach } from '@fliwright/vitest'");
    expect(code).toContain("beforeEach(async ({ page }) => {");
    expect(code).toContain("await page.resetToHome({ homeRoute: '/home' })");
  });

  it('escapes string literals in generated code', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [typeOp(100, 200, "line 1\nline '2'", 1000)];
    const selectors = sel({ 0: { match: { text: 'Notes' } } });
    const code = gen.generate(ops, selectors, {
      testName: "user's notes",
      imports: "@scope/fliwright\\vitest",
    });
    expect(code).toContain("import { test, expect } from '@scope/fliwright\\\\vitest'");
    expect(code).toContain("test('user\\'s notes'");
    expect(code).toContain("type('line 1\\nline \\'2\\'')");
  });

  it('keeps unresolved taps as coordinate drafts without inventing a Widget selector', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ];
    const selectors = new Map<number, ResolvedSelector>();
    const code = gen.generate(ops, selectors);
    expect(code).toContain('page.clickAt(100, 200)');
    expect(code).not.toContain("type: 'Widget'");
  });

  it('preserves fractional drag duration for located and coordinate replay', () => {
    const operation = { ...drag(10, 20, 0, -240, 100), durationMs: 1281.008 };
    const generator = new CodeGenerator();
    expect(generator.generate([operation], sel({ 0: { match: { key: 'list' } } })))
      .toContain('.drag(0, -240, { duration: 1281.008 })');
    expect(generator.generate([operation], new Map()))
      .toContain('page.dragFrom(10, 20, 0, -240, { duration: 1281.008 })');
  });

  it('preserves unresolved drags and blocks replaying unresolved input or long press', () => {
    const gen = new CodeGenerator();
    const code = gen.generate([
      drag(10, 20, 30, 40, 100), typeOp(0, 0, 'typed', 200), longPress(10, 20, 600, 300),
    ], new Map());
    expect(code).toContain('page.dragFrom(10, 20, 30, 40)');
    expect(code).toContain('throw new Error(');
    expect(code).toContain('Unresolved type target');
    expect(code).toContain('Unresolved longPress target');
    expect(code).not.toContain("type: 'Widget'");
  });

  it('generates fill() for type operations with action:replace', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'type', position: { x: 100, y: 200 }, text: 'ab', action: 'replace', timestamp: 1000 },
    ];
    const selectors = sel({ 0: { match: { text: 'Field' } } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Field' }).fill('ab')");
    expect(code).not.toContain('.type(');
  });

  it('generates multiple operations in sequence', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      tap(100, 200, 1000),
      tap(100, 300, 2000),
    ];
    const selectors = sel({ 0: { match: { text: 'User' } }, 1: { match: { text: 'Pass' } } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'User' }).click({ waitForAnimations: true })");
    expect(code).toContain("page.locator({ text: 'Pass' }).click({ waitForAnimations: true })");
  });

  it('skips ignored operations', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      tap(100, 200, 1000),
      { ...tap(102, 202, 1100), status: 'ignored', ignoreReason: 'duplicate' },
      typeOp(100, 300, 'ok', 2000),
    ];
    const selectors = sel({
      0: { match: { text: 'Open' } },
      1: { match: { text: 'Open' } },
      2: { match: { text: 'Field' } },
    });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Open' }).click({ waitForAnimations: true })");
    expect(code).toContain("page.locator({ text: 'Field' }).type('ok')");
    expect(code.match(/Open/g)).toHaveLength(1);
  });

  it('generates timeline-aware test code when requested', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      tap(100, 200, 1000),
      typeOp(100, 300, 'ada@example.com', 2000),
    ];
    const selectors = sel({
      0: { match: { text: 'Register' } },
      1: { match: { key: 'emailField' } },
    });

    const code = gen.generate(ops, selectors, { timeline: true, mode: 'test', testName: 'register flow' });

    expect(code).toContain("import { test } from '@fliwright/vitest'");
    expect(code).toContain("test('register flow', async ({ page, flow, mock, assert, agent }) => {");
    expect(code).toContain("await flow.step('Tap target', async () => {");
    expect(code).toContain("await page.locator({ text: 'Register' }).click({ waitForAnimations: true });");
    expect(code).toContain("await flow.step('Type text', async () => {");
    expect(code).toContain("await page.locator({ key: 'emailField' }).type('ada@example.com');");
  });

  it('generates timeline-aware script code when requested', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = sel({ 0: { match: { text: 'Start' } } });

    const code = gen.generate(ops, selectors, { timeline: true, mode: 'script', testName: 'open app' });

    expect(code).toContain("import { script } from '@fliwright/vitest'");
    expect(code).toContain("script('open app', async ({ page, flow, mock, agent }) => {");
    expect(code).toContain("await flow.step('Tap target', async () => {");
  });

  it('emits timeline frames for recorded screenshots', () => {
    const gen = new CodeGenerator();
    const operations: RecordedOperation[] = [tap(100, 200, 1000)];
    const frames: RecordingFrame[] = [{
      id: 'frame-1',
      index: 0,
      kind: 'tap',
      status: 'ready',
      timestamp: 1000,
      position: { x: 100, y: 200 },
      operationIndex: 0,
      screenshot: { path: 'screenshots/frame.png', byteLength: 3, format: 'png' },
    }];

    const code = gen.generate(operations, sel({ 0: { match: { text: 'Start' } } }), {
      timeline: true,
      recordingFrames: frames,
    });

    expect(code).toContain("await flow.frame('Recorded frame 1', { screenshot: true });");
  });

  it('keeps suggestions unconfirmed even when a postcondition target exists', () => {
    const code = new CodeGenerator().generate(
      [tap(100, 200, 1000), tap(100, 300, 2000)],
      sel({
        0: { match: { text: 'Register' } },
        1: { match: { text: 'Account details' } },
      }),
      {
        timeline: true,
        mode: 'test',
        assertionSuggestions: [{
          afterIndex: 0,
          targetOperationIndex: 1,
          reason: 'possible navigation tap',
          template: '// TODO: Assert expected page content',
        }],
      },
    );

    expect(code).toContain('// TODO: Assert expected page content');
    expect(code).not.toContain('await assert.visible(');
    expect(code).not.toContain('await expect(');
  });

  it('keeps suggestions as TODO comments without a reliable postcondition target', () => {
    const code = new CodeGenerator().generate(
      [tap(100, 200, 1000)],
      sel({ 0: { match: { text: 'Register' } } }),
      {
        timeline: true,
        mode: 'test',
        assertionSuggestions: [{
          afterIndex: 0,
          reason: 'possible navigation tap',
          template: '// TODO: Assert expected page content',
        }],
      },
    );

    expect(code).toContain('// TODO: Assert expected page content');
    expect(code).not.toContain('await assert.visible(');
  });
});

const op = (over: Partial<RecordedOperation> = {}): RecordedOperation =>
  ({ kind: 'tap', position: { x: 1, y: 1 }, timestamp: 1, ...over });

describe('CodeGenerator structured selectors', () => {
  it('serializes a simple selector as shorthand', () => {
    const selectors = new Map<number, ResolvedSelector>([
      [0, { query: { match: { text: 'Login' } }, ambiguous: false, matchCount: 1 }],
    ]);
    const code = new CodeGenerator().generate([op()], selectors);
    expect(code).toContain("page.locator({ text: 'Login' }).click({ waitForAnimations: true })");
  });

  it('serializes a within-scoped selector', () => {
    const selectors = new Map<number, ResolvedSelector>([
      [0, {
        query: { match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } },
        ambiguous: false, matchCount: 1,
      }],
    ]);
    const code = new CodeGenerator().generate([op()], selectors);
    expect(code).toContain("within: { match: { key: 'list' } }");
  });

  it('emits an ambiguous comment for an nth fallback', () => {
    const selectors = new Map<number, ResolvedSelector>([
      [0, { query: { match: { type: 'GestureDetector' }, position: { nth: 3 } }, ambiguous: true, matchCount: 5 }],
    ]);
    const code = new CodeGenerator().generate([op()], selectors);
    expect(code).toContain('// ambiguous: matched 5');
    expect(code).toContain('page.locator(');
  });
});
