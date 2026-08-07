// packages/fliwright-core/tests/CodeGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../src/CodeGenerator.js';
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
  it('generates a complete test file with imports', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = sel({ 0: { match: { text: 'Login' } } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("test('recorded test'");
    expect(code).toContain("page.locator({ text: 'Login' }).click()");
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

  it('falls back to type selector when no selector provided', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ];
    const selectors = new Map<number, ResolvedSelector>();
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ type: 'Widget' })");
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
    expect(code).toContain("page.locator({ text: 'User' }).click()");
    expect(code).toContain("page.locator({ text: 'Pass' }).click()");
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
    expect(code).toContain("page.locator({ text: 'Open' }).click()");
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
    expect(code).toContain("await page.locator({ text: 'Register' }).click();");
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
      screenshot: { base64: 'png', format: 'png' },
    }];

    const code = gen.generate(operations, sel({ 0: { match: { text: 'Start' } } }), {
      timeline: true,
      recordingFrames: frames,
    });

    expect(code).toContain("await flow.frame('Recorded frame 1', { screenshot: true });");
  });

  it('emits a timeline-native assertion only for a recorded postcondition target', () => {
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
    expect(code).toContain("await assert.visible('Suggested: possible navigation tap', page.locator({ text: 'Account details' }));");
    expect(code).not.toContain("assert.visible('Suggested: possible navigation tap', page.locator({ text: 'Register' }))");
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
    expect(code).toContain("page.locator({ text: 'Login' }).click()");
  });

  it('serializes a within-scoped selector', () => {
    const selectors = new Map<number, ResolvedSelector>([
      [0, {
        query: { match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } },
        ambiguous: false, matchCount: 1,
      }],
    ]);
    const code = new CodeGenerator().generate([op()], selectors);
    expect(code).toContain("within: { key: 'list' }");
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
