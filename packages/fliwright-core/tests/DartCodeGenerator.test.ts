import { describe, it, expect } from 'vitest';
import { DartCodeGenerator } from '../src/DartCodeGenerator.js';
import type { RecordedOperation, ResolvedSelector } from '../src/types.js';

function ds(query: ResolvedSelector['query']): Map<number, ResolvedSelector> {
  return new Map([[0, { query, ambiguous: false, matchCount: 1 }]]);
}

describe('DartCodeGenerator', () => {
  it('generates a complete Dart integration test file', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ];
    const selectors = ds({ match: { text: 'Login' } });
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
    const selectors = ds({ match: { text: 'Field' } });
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
    const selectors = ds({ match: { text: 'Card' } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain('longPress');
  });

  it('generates drag with offset', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'drag', position: { x: 100, y: 200 }, delta: { x: 50, y: -30 }, timestamp: 1000 },
    ];
    const selectors = ds({ match: { text: 'Slider' } });
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
    const selectors = new Map<number, ResolvedSelector>([
      [0, { query: { match: { text: 'Email Tab' } }, ambiguous: false, matchCount: 1 }],
      [1, { query: { match: { text: 'Email' } }, ambiguous: false, matchCount: 1 }],
      [2, { query: { match: { text: 'Submit' } }, ambiguous: false, matchCount: 1 }],
    ]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("find.text('Email Tab')");
    expect(code).toContain("find.text('Email')");
    expect(code).toContain("find.text('Submit')");
  });

  it('skips ignored operations', () => {
    const gen = new DartCodeGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
      { kind: 'tap', position: { x: 102, y: 202 }, timestamp: 1100, status: 'ignored', ignoreReason: 'duplicate' },
    ];
    const selectors = new Map<number, ResolvedSelector>([
      [0, { query: { match: { text: 'Open' } }, ambiguous: false, matchCount: 1 }],
      [1, { query: { match: { text: 'Duplicate' } }, ambiguous: false, matchCount: 1 }],
    ]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("find.text('Open')");
    expect(code).not.toContain('Duplicate');
  });
});

const tap: RecordedOperation = { kind: 'tap', position: { x: 1, y: 1 }, timestamp: 1 };

function gen(query: ResolvedSelector['query']): string {
  return new DartCodeGenerator().generate([tap], new Map([[0, { query, ambiguous: false, matchCount: 1 }]]));
}

describe('DartCodeGenerator structured finders', () => {
  it('text → find.text', () => {
    expect(gen({ match: { text: 'Login' } })).toContain("find.text('Login')");
  });
  it('key → find.byKey', () => {
    expect(gen({ match: { key: 'submit' } })).toContain("find.byKey(const Key('submit'))");
  });
  it('type → find.byType', () => {
    expect(gen({ match: { type: 'GestureDetector' } })).toContain('find.byType(GestureDetector)');
  });
  it('tooltip → find.byTooltip', () => {
    expect(gen({ match: { tooltip: 'Add' } })).toContain("find.byTooltip('Add')");
  });
  it('semanticsLabel → find.bySemanticsLabel', () => {
    expect(gen({ match: { semanticsLabel: 'Open' } })).toContain("find.bySemanticsLabel('Open')");
  });
  it('within → find.descendant', () => {
    const code = gen({ match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } });
    expect(code).toContain('find.descendant(');
    expect(code).toContain("of: find.byKey(const Key('list'))");
    expect(code).toContain('matching: find.byType(GestureDetector)');
  });
  it('containing → find.ancestor', () => {
    const code = gen({ match: { type: 'GestureDetector' }, containing: { match: { text: 'Login' } } });
    expect(code).toContain('find.ancestor(');
    expect(code).toContain("matching: find.text('Login')");
    expect(code).toContain('of: find.byType(GestureDetector)');
  });
  it('nth → .at', () => {
    expect(gen({ match: { type: 'GestureDetector' }, position: { nth: 2 } })).toContain('find.byType(GestureDetector).at(2)');
  });
  it('last → .last', () => {
    expect(gen({ match: { type: 'GestureDetector' }, position: { last: true } })).toContain('find.byType(GestureDetector).last');
  });
});
