import { describe, it, expect } from 'vitest';
import { DartCodeGenerator } from '../src/DartCodeGenerator.js';
import type { CodegenOptions, RecordedOperation, ResolvedSelector } from '../src/types.js';

const appOptions = { dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart' } satisfies CodegenOptions;
class AppGenerator extends DartCodeGenerator {
  override generate(ops: RecordedOperation[], selectors: Map<number, ResolvedSelector>, options?: CodegenOptions): string {
    return super.generate(ops, selectors, { ...appOptions, ...options });
  }
}

function ds(query: ResolvedSelector['query']): Map<number, ResolvedSelector> {
  return new Map([[0, { query, ambiguous: false, matchCount: 1 }]]);
}

describe('DartCodeGenerator', () => {
  it('blocks an unresolved recorded target instead of inventing a generic finder', () => {
    const code = new AppGenerator().generate([
      { kind: 'tap', position: { x: 10, y: 20 }, timestamp: 100 },
    ], new Map());
    expect(code).toContain("throw StateError('Unresolved tap target");
    expect(code).not.toContain('find.byType(Widget)');
  });
  it('generates a complete Dart integration test file', () => {
    const gen = new AppGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
    ];
    const selectors = ds({ match: { text: 'Login' } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("import 'package:flutter_test/flutter_test.dart'");
    expect(code).toContain('IntegrationTestWidgetsFlutterBinding.ensureInitialized()');
    expect(code).toContain("testWidgets('recorded test'");
    expect(code).toContain("_recordedText(widget) == 'Login'");
    expect(code).toContain('await tester.tap(');
    expect(code).toContain('await tester.pumpAndSettle()');
    expect(code).toContain("import 'package:form_demo/recording_replay_main.dart' as app;");
    expect(code).toContain('await Future<void>.sync(app.main);');
    expect(code.indexOf('app.main')).toBeLessThan(code.indexOf('await tester.tap'));
  });

  it('uses an explicit Dart environment parameter for sensitive input', () => {
    const code = new AppGenerator().generate([
      { kind: 'type', position: { x: 0, y: 0 }, timestamp: 1, text: '<masked>', sensitive: true },
    ], ds({ match: { key: 'password' } }));
    expect(code).toContain("bool.hasEnvironment('FLIWRIGHT_INPUT_1')");
    expect(code).toContain("String.fromEnvironment('FLIWRIGHT_INPUT_1')");
    expect(code).not.toContain('<masked>');
  });

  it('generates enterText for type operations', () => {
    const gen = new AppGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'type', position: { x: 100, y: 200 }, text: 'hello', timestamp: 1000 },
    ];
    const selectors = ds({ match: { text: 'Field' } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain("_recordedText(widget) == 'Field'");
    expect(code).toContain("enterText(");
    expect(code).toContain("'hello'");
  });

  it('preserves the recorded long press duration in milliseconds', () => {
    const gen = new AppGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'longPress', position: { x: 100, y: 200 }, durationMs: 600, timestamp: 1000 },
    ];
    const selectors = ds({ match: { text: 'Card' } });
    const code = gen.generate(ops, selectors);
    expect(code).toContain('Duration(milliseconds: 600)');
    expect(code).toContain('startGesture');
    expect(code).toContain('gesture0.up()');
  });

  it('replays a fractional drag duration with timedDrag', () => {
    const code = new AppGenerator().generate([
      { kind: 'drag', position: { x: 100, y: 200 }, delta: { x: 0, y: -240 }, durationMs: 1281.008, timestamp: 1000 },
    ], ds({ match: { key: 'list' } }));
    expect(code).toContain('await tester.timedDrag(');
    expect(code).toContain('const Offset(0, -240), const Duration(microseconds: 1281008)');
  });

  it.each([0, -1, NaN, Infinity])('blocks invalid drag duration %s', (durationMs) => {
    const result = new AppGenerator().generateResult([
      { kind: 'drag', position: { x: 0, y: 0 }, delta: { x: 0, y: -240 }, durationMs, timestamp: 1 },
    ], ds({ match: { key: 'list' } }), appOptions);
    expect(result.issues.join(' ')).toContain('drag requires a positive finite durationMs');
    expect(result.code).not.toContain('await tester.timedDrag(');
  });

  it('generates drag with offset', () => {
    const gen = new AppGenerator();
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
    const gen = new AppGenerator();
    const ops: RecordedOperation[] = [];
    const code = gen.generate(ops, new Map(), { testName: 'login flow' });
    expect(code).toContain("testWidgets('login flow'");
  });

  it('generates multiple operations in sequence', () => {
    const gen = new AppGenerator();
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
    expect(code).toContain("_recordedText(widget) == 'Email Tab'");
    expect(code).toContain("_recordedText(widget) == 'Email'");
    expect(code).toContain("_recordedText(widget) == 'Submit'");
  });

  it('skips ignored operations', () => {
    const gen = new AppGenerator();
    const ops: RecordedOperation[] = [
      { kind: 'tap', position: { x: 100, y: 200 }, timestamp: 1000 },
      { kind: 'tap', position: { x: 102, y: 202 }, timestamp: 1100, status: 'ignored', ignoreReason: 'duplicate' },
    ];
    const selectors = new Map<number, ResolvedSelector>([
      [0, { query: { match: { text: 'Open' } }, ambiguous: false, matchCount: 1 }],
      [1, { query: { match: { text: 'Duplicate' } }, ambiguous: false, matchCount: 1 }],
    ]);
    const code = gen.generate(ops, selectors);
    expect(code).toContain("_recordedText(widget) == 'Open'");
    expect(code).not.toContain('Duplicate');
  });
});

const tap: RecordedOperation = { kind: 'tap', position: { x: 1, y: 1 }, timestamp: 1 };

function gen(query: ResolvedSelector['query']): string {
  return new AppGenerator().generate([tap], new Map([[0, { query, ambiguous: false, matchCount: 1 }]]));
}

describe('DartCodeGenerator structured finders', () => {
  it('text preserves the bridge matcher for Text, RichText and EditableText elements', () => {
    const code = gen({ match: { text: 'Login' } });
    expect(code).toContain("_recordedText(widget) == 'Login'");
    expect(code).toContain('if (widget is Text)');
    expect(code).toContain('if (widget is RichText)');
    expect(code).toContain('if (widget is EditableText)');
  });
  it('key preserves numeric and string ValueKey matching', () => {
    expect(gen({ match: { key: 'submit' } })).toContain("_recordedKey('submit')");
  });
  it('type compares runtime type names without inventing app imports', () => {
    expect(gen({ match: { type: 'GestureDetector' } })).toContain("widget.runtimeType.toString() == 'GestureDetector'");
  });
  it('within → find.descendant', () => {
    const code = gen({ match: { type: 'GestureDetector' }, within: { match: { key: 'list' } } });
    expect(code).toContain('find.descendant(');
    expect(code).toContain("of: _recordedKey('list')");
    expect(code).toContain("widget.runtimeType.toString() == 'GestureDetector'");
  });
  it('containing → find.ancestor', () => {
    const code = gen({ match: { type: 'GestureDetector' }, containing: { match: { text: 'Login' } } });
    expect(code).toContain('find.ancestor(');
    // Text and its RichText child can both match; the parent must appear once.
    expect(code).toContain('find.byElementPredicate((element) => find.ancestor(');
    expect(code).toContain('.evaluate().contains(element))');
    expect(code).toContain("of: find.byWidgetPredicate((widget) => _recordedText(widget) == 'Login')");
    expect(code).toContain("widget.runtimeType.toString() == 'GestureDetector'");
  });
  it('nth → .at', () => {
    expect(gen({ match: { type: 'GestureDetector' }, position: { nth: 2 } })).toContain('.at(2)');
  });
  it('last → .last', () => {
    expect(gen({ match: { type: 'GestureDetector' }, position: { last: true } })).toContain('.last');
  });
});

describe('Dart generation capability gate', () => {
  it('requires an explicit package app entrypoint before replay can change the app', () => {
    const result = new DartCodeGenerator().generateResult([tap], ds({ match: { key: 'save' } }));
    expect(result.issues.join(' ')).toMatch(/app entrypoint/i);
    expect(result.code).toContain('throw StateError(');
    expect(result.code).not.toContain('await tester.tap(');
  });

  it.each([
    { match: { role: 'button' } },
    { match: { semanticsHint: 'Open' } },
    { match: { semanticsLabel: 'Open' } },
    { match: { tooltip: 'Open' } },
    { match: { name: 'save' } },
    { match: { ancestorKey: 'panel' } },
    { match: { semanticIdentifier: 'save' } },
    { match: { key: 'save', enabled: false } },
    { match: { iconCodePoint: 1234 } },
    { match: { key: 'save' }, filter: { visible: false } },
    { match: { key: 'save' }, within: { match: { role: 'form' } } },
    { match: { key: 'save' }, and: [{ match: { key: 'other' } }] },
    { match: { key: 'save' }, fallback: { textContains: 'Save' } },
    { match: { key: 'save' }, position: { visible: true } },
    { match: { key: 'save' }, position: { first: true, last: true } },
    { match: { key: 'save' }, position: { nth: -1 } },
    {},
  ])('returns an explicit issue for a query it cannot faithfully translate: %j', (query) => {
    const result = new DartCodeGenerator().generateResult([tap], ds(query), appOptions);
    expect(result.issues.join(' ')).toMatch(/operation 1/i);
    expect(result.code).not.toContain('await tester.tap(');
    expect(result.code).not.toContain('find.byType(Widget)');
    expect(result.code).not.toContain('find.bySemanticsLabel(');
  });

  it('does not silently drop another supported match criterion', () => {
    const code = gen({ match: { key: 'save', type: 'FilledButton' } });
    expect(code).toContain("_recordedKey('save')");
    expect(code).toContain("widget.runtimeType.toString() == 'FilledButton'");
    expect(code).toContain('every(');
  });

  it('rejects unknown query fields at runtime instead of ignoring them', () => {
    const query = { match: { key: 'save' }, unsupportedConstraint: true };
    const result = new DartCodeGenerator().generateResult([tap], ds(query), appOptions);
    expect(result.issues.join(' ')).toContain('unsupported query.unsupportedConstraint');
    expect(result.code).not.toContain('app.main');
  });

  it.each([undefined, 0, -1, Number.NaN])('rejects a long press without a valid durationMs: %s', (durationMs) => {
    const result = new DartCodeGenerator().generateResult([{ ...tap, kind: 'longPress', durationMs }], ds({ match: { key: 'save' } }), appOptions);
    expect(result.issues.join(' ')).toContain('longPress requires a positive durationMs');
  });

  it('checks every sensitive replay parameter before app startup', () => {
    const code = new AppGenerator().generate([{ ...tap, kind: 'type', sensitive: true, text: '<masked>' }], ds({ match: { key: 'input' } }));
    expect(code.indexOf('bool.hasEnvironment')).toBeLessThan(code.indexOf('await Future<void>.sync(app.main)'));
    expect(code).not.toContain('<masked>');
  });

  it('escapes Dart interpolation in recorded strings and test names', () => {
    const code = new AppGenerator().generate([{ ...tap, kind: 'type', text: '$token\n${value}' }],
      ds({ match: { key: '$field' } }), { testName: '${title}' });
    expect(code).toContain("'\\$token\\n\\${value}'");
    expect(code).toContain("'\\$field'");
    expect(code).toContain("'\\${title}'");
  });

  it('runs only confirmed supported checkpoints at their recorded action boundary', () => {
    const code = new AppGenerator().generate([tap], ds({ match: { key: 'save' } }), {
      checkpoints: [{ id: 'saved', source: 'snapshot', confirmed: true, query: { match: { key: 'result' } },
        matcher: 'toHaveText', expected: 'Saved', afterOperationIndex: 0 }],
    });
    expect(code).toContain("expect(_recordedText(tester.widget(_recordedKey('result'))), 'Saved'");
    expect(code.indexOf('await tester.tap(')).toBeLessThan(code.indexOf('expect('));
  });

  it('rejects unsupported assertions instead of losing confirmed business checks', () => {
    const result = new DartCodeGenerator().generateResult([tap], ds({ match: { key: 'save' } }), {
      ...appOptions, checkpoints: [{ id: 'enabled', source: 'snapshot', confirmed: true,
        query: { match: { key: 'result' } }, matcher: 'toBeEnabled', expected: true }],
    });
    expect(result.issues.join(' ')).toMatch(/checkpoint.*enabled.*toBeEnabled/i);
    expect(result.assertionCount).toBe(0);
    expect(result.code).not.toContain('await tester.tap(');
  });
});
