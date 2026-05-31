import { describe, it, expect } from 'vitest';
import { DartCodeGenerator } from '../src/DartCodeGenerator.js';
import type { RecordedOperation } from '../src/types.js';

describe('DartCodeGenerator', () => {
  it('generates a complete Dart integration test file', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ];
    const selectors = new Map<number, string>([[0, "{ text: 'Login' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("import 'package:flutter_test/flutter_test.dart'");
    expect(code).toContain('IntegrationTestWidgetsFlutterBinding.ensureInitialized()');
    expect(code).toContain("testWidgets('recorded test'");
    expect(code).toContain("find.text('Login')");
    expect(code).toContain('await tester.tap(');
    expect(code).toContain('await tester.pumpAndSettle()');
  });

  it('generates enterText for type operations', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'type', position: { x: 100, y: 200 }, text: 'hello', timestamp: 1000 },
    ];
    const selectors = new Map<number, string>([[0, "{ text: 'Field' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("find.text('Field')");
    expect(code).toContain("enterText(");
    expect(code).toContain("'hello'");
  });

  it('generates longPress with duration comment', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'longPress', position: { x: 100, y: 200 }, duration: 500, timestamp: 1000 },
    ];
    const selectors = new Map<number, string>([[0, "{ text: 'Card' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain('longPress');
  });

  it('generates drag with offset', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'drag', position: { x: 100, y: 200 }, delta: { x: 50, y: -30 }, timestamp: 1000 },
    ];
    const selectors = new Map<number, string>([[0, "{ text: 'Slider' }"]]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain('drag');
    expect(code).toContain('50');
    expect(code).toContain('-30');
  });

  it('uses custom test name', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [];
    const code = gen.generate(ops, new Map(), { testName: 'login flow' });
    expect(code).toContain("testWidgets('login flow'");
  });

  it('generates multiple operations in sequence', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
      { kind: 'type', position: { x: 100, y: 300 }, text: 'test@email.com', timestamp: 2000 },
      { kind: 'tap', position: { x: 100, y: 400 }, timestamp: 3000 },
    ];
    const selectors = new Map<number, string>([
      [0, "{ text: 'Email Tab' }"],
      [1, "{ text: 'Email' }"],
      [2, "{ text: 'Submit' }"],
    ]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("find.text('Email Tab')");
    expect(code).toContain("find.text('Email')");
    expect(code).toContain("find.text('Submit')");
  });
});
