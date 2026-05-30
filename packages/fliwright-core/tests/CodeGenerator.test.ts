// packages/fliwright-core/tests/CodeGenerator.test.ts
import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../src/CodeGenerator.js';
import type { RecordedOperation } from '../src/types.js';

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

describe('CodeGenerator', () => {
  it('generates a complete test file with imports', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Login' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("import { test, expect } from '@fliwright/vitest'");
    expect(code).toContain("test('recorded test'");
    expect(code).toContain("page.locator({ text: 'Login' }).click()");
  });

  it('generates type operations', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [typeOp(100, 200, 'alice@test.com', 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Email' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Email' }).type('alice@test.com')");
  });

  it('generates longPress operations with duration', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [longPress(100, 200, 500, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Card' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Card' }).longPress({ duration: 500 })");
  });

  it('generates drag operations with delta', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [drag(100, 200, 50, -30, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Slider' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'Slider' }).drag(50, -30)");
  });

  it('uses custom test name', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [tap(100, 200, 1000)];
    const selectors = new Map<number, string>([[0, "{ text: 'Btn' }"]]);
    const code = gen.generate(ops, selectors, { testName: 'login flow' });
    expect(code).toContain("test('login flow'");
  });

  it('falls back to type selector when no selector provided', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ];
    const selectors = new Map<number, string>();
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ type: 'Widget' })");
  });

  it('generates multiple operations in sequence', () => {
    const gen = new CodeGenerator();
    const ops: RecordedOperation[] = [
      tap(100, 200, 1000),
      tap(100, 300, 2000),
    ];
    const selectors = new Map<number, string>([
      [0, "{ text: 'User' }"],
      [1, "{ text: 'Pass' }"],
    ]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("page.locator({ text: 'User' }).click()");
    expect(code).toContain("page.locator({ text: 'Pass' }).click()");
  });
});
