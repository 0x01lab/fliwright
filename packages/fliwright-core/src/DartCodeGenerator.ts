import type { RecordedOperation, CodegenOptions, ResolvedSelector, SelectorQuery } from './types.js';
import { recordingInputParameters } from './RecordingInputs.js';
import { prepareRecordingCheckpoints } from './RecordingCheckpoints.js';

export interface DartCodeGenerationResult {
  code: string;
  issues: string[];
  assertionCount: number;
}

/** Emits only queries whose element semantics can be preserved in a standalone Flutter test. */
export class DartCodeGenerator {
  generate(operations: RecordedOperation[], selectors: Map<number, ResolvedSelector>, options?: CodegenOptions): string {
    return this.generateResult(operations, selectors, options).code;
  }

  generateResult(
    operations: RecordedOperation[],
    selectors: ReadonlyMap<number, ResolvedSelector>,
    options?: CodegenOptions,
  ): DartCodeGenerationResult {
    const issues: string[] = [];
    const entrypoint = options?.dartAppEntrypoint;
    if (!entrypoint || !/^package:[a-z][a-z0-9_]*\/[a-zA-Z0-9_/-]+\.dart$/.test(entrypoint)) {
      issues.push('Dart output requires an explicit app entrypoint package URI (dartAppEntrypoint), compatible with IntegrationTestWidgetsFlutterBinding. Install integration_test in the target app.');
    }
    if (options?.resetToHomeBeforeEach) {
      issues.push('Dart output does not support the TS home reset hook; configure the initial route in the app entrypoint.');
    }
    const finders = new Map<number, string>();
    for (const [index, operation] of operations.entries()) {
      if (operation.status === 'ignored') continue;
      const selector = selectors.get(index);
      if (!selector) {
        issues.push(`Unresolved ${operation.kind} target at operation ${index + 1}; review the recording before replay.`);
        continue;
      }
      try {
        finders.set(index, dartFinder(selector.query));
      } catch (error) {
        issues.push(`Dart operation ${index + 1}: ${(error as Error).message}`);
      }
      if (selector.ambiguous || selector.matchCount !== 1) {
        issues.push(`Dart operation ${index + 1}: target was not verified unique.`);
      }
      if (operation.kind === 'longPress' && (!Number.isSafeInteger(operation.durationMs) || operation.durationMs! <= 0)) {
        issues.push(`Dart operation ${index + 1}: longPress requires a positive durationMs.`);
      }
      if (operation.kind === 'drag' && (!operation.delta || !Number.isFinite(operation.delta.x) || !Number.isFinite(operation.delta.y))) {
        issues.push(`Dart operation ${index + 1}: drag requires a finite delta in logical pixels.`);
      }
      if (operation.kind === 'drag' && operation.durationMs != null && (!Number.isFinite(operation.durationMs) || operation.durationMs <= 0)) {
        issues.push(`Dart operation ${index + 1}: drag requires a positive finite durationMs.`);
      }
    }
    const checkpoints = prepareRecordingCheckpoints(options?.checkpoints, operations.length);
    issues.push(...checkpoints.issues);
    const checkpointLines = new Map<number, string[]>();
    let assertionCount = 0;
    for (const checkpoint of checkpoints.executable) {
      try {
        const finder = dartFinder(checkpoint.query!);
        const reason = `, reason: '${escapeString(checkpoint.reason ?? checkpoint.id)}'`;
        let assertion: string;
        switch (checkpoint.matcher) {
          case 'toHaveText':
            assertion = `expect(_recordedText(tester.widget(${finder})), '${escapeString(checkpoint.expected as string)}'${reason});`;
            break;
          case 'toContainText':
            assertion = `expect(_recordedText(tester.widget(${finder})), contains('${escapeString(checkpoint.expected as string)}')${reason});`;
            break;
          case 'toBeVisible':
            assertion = `expect(${finder}.hitTestable(), ${checkpoint.expected === false ? 'findsNothing' : 'findsWidgets'}${reason});`;
            break;
          default:
            throw new Error(`unsupported matcher ${checkpoint.matcher}`);
        }
        const boundary = checkpoint.afterOperationIndex ?? operations.length - 1;
        checkpointLines.set(boundary, [...(checkpointLines.get(boundary) ?? []), `    ${assertion}`]);
        assertionCount++;
      } catch (error) {
        issues.push(`Dart checkpoint '${checkpoint.id}': ${(error as Error).message}`);
      }
    }

    const body: string[] = [];
    if (issues.length) {
      // A draft must fail before app startup and cannot replay a partially translated sequence.
      body.push(`    throw StateError('${escapeString(issues.join('; '))}');`);
    } else {
      const parameters = recordingInputParameters(operations);
      for (const [index, name] of parameters) {
        body.push(`    if (!(const bool.hasEnvironment('${name}'))) throw StateError('Missing recording input parameter: ${name}');`);
        body.push(`    const recordedInput${index + 1} = String.fromEnvironment('${name}');`);
      }
      body.push('    await Future<void>.sync(app.main);');
      body.push('    await tester.pumpAndSettle();');
      body.push(...(checkpointLines.get(-1) ?? []));
      for (const [index, operation] of operations.entries()) {
        if (operation.status !== 'ignored') {
          const finder = finders.get(index)!;
          switch (operation.kind) {
            case 'tap':
              body.push(`    await tester.tap(${finder});`);
              break;
            case 'longPress':
              body.push(`    final gesture${index} = await tester.startGesture(tester.getCenter(${finder}));`);
              body.push('    try {');
              body.push(`      await tester.pump(const Duration(milliseconds: ${operation.durationMs}));`);
              body.push('    } finally {');
              body.push(`      await gesture${index}.up();`);
              body.push('    }');
              break;
            case 'drag':
              body.push(operation.durationMs == null
                ? `    await tester.drag(${finder}, const Offset(${operation.delta!.x}, ${operation.delta!.y}));`
                : `    await tester.timedDrag(${finder}, const Offset(${operation.delta!.x}, ${operation.delta!.y}), const Duration(microseconds: ${Math.round(operation.durationMs * 1000)}));`);
              break;
            case 'type': {
              const value = parameters.has(index) ? `recordedInput${index + 1}` : `'${escapeString(operation.text ?? '')}'`;
              body.push(`    await tester.enterText(${finder}, ${value});`);
              break;
            }
          }
          body.push('    await tester.pumpAndSettle();');
        }
        body.push(...(checkpointLines.get(index) ?? []));
      }
    }
    const needsKey = !issues.length && body.some((line) => line.includes('_recordedKey('));
    const needsText = !issues.length && body.some((line) => line.includes('_recordedText('));
    const needsWidgets = needsKey || needsText || (!issues.length && operations.some((op) => op.kind === 'drag' && op.status !== 'ignored'));
    const lines = [
      '// Requires integration_test in the target app dev_dependencies.',
      ...(needsWidgets ? ["import 'package:flutter/widgets.dart';"] : []),
      "import 'package:flutter_test/flutter_test.dart';",
      "import 'package:integration_test/integration_test.dart';",
      ...(!issues.length ? [`import '${entrypoint}' as app;`] : []),
      '', 'void main() {', '  IntegrationTestWidgetsFlutterBinding.ensureInitialized();', '',
      `  testWidgets('${escapeString(options?.testName ?? 'recorded test')}', (WidgetTester tester) async {`,
      ...body, '  });', '}',
    ];
    if (needsKey) lines.push('', KEY_HELPER);
    if (needsText) lines.push('', TEXT_HELPER);
    return { code: lines.join('\n'), issues, assertionCount: issues.length ? 0 : assertionCount };
  }
}

function dartFinder(query: SelectorQuery): string {
  for (const field of Object.keys(query)) {
    if (!['match', 'within', 'containing', 'position'].includes(field)) throw new Error(`unsupported query.${field}`);
  }
  const matches = Object.entries(query.match ?? {});
  if (!matches.length) throw new Error('query requires a supported match criterion');
  const finders = matches.map(([field, value]) => {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`unsupported match.${field}`);
    const literal = `'${escapeString(value)}'`;
    switch (field) {
      case 'key': return `_recordedKey(${literal})`;
      case 'text': return `find.byWidgetPredicate((widget) => _recordedText(widget) == ${literal})`;
      case 'type': return `find.byWidgetPredicate((widget) => widget.runtimeType.toString() == ${literal})`;
      default: throw new Error(`unsupported match.${field}`);
    }
  });
  let finder = finders.length === 1 ? finders[0]
    : `find.byElementPredicate((element) => <Finder>[${finders.join(', ')}].every((finder) => finder.evaluate().contains(element)))`;
  if (query.within) finder = `find.descendant(of: ${dartFinder(query.within)}, matching: ${finder})`;
  // Flutter ancestor finders can emit the same ancestor for both Text and its
  // RichText child. SelectorQuery matches each element once.
  if (query.containing) finder = `find.byElementPredicate((element) => find.ancestor(of: ${dartFinder(query.containing)}, matching: ${finder}).evaluate().contains(element))`;
  if (query.position) {
    const entries = Object.entries(query.position);
    if (entries.length !== 1) throw new Error('unsupported or conflicting query.position');
    const [field, value] = entries[0];
    if (field === 'nth' && Number.isSafeInteger(value) && (value as number) >= 0) return `${finder}.at(${value})`;
    if (field === 'first' && value === true) return `${finder}.first`;
    if (field === 'last' && value === true) return `${finder}.last`;
    throw new Error(`unsupported position.${field}`);
  }
  return finder;
}

const KEY_HELPER = `Finder _recordedKey(String expected) => find.byWidgetPredicate((widget) {
  final key = widget.key;
  if (key is ValueKey<String>) return key.value == expected;
  if (key is ValueKey<int>) return key.value == int.tryParse(expected);
  if (key is ValueKey<double>) return key.value == double.tryParse(expected);
  return key is ValueKey && key.value.toString() == expected;
});`;

const TEXT_HELPER = `String? _recordedText(Widget widget) {
  if (widget is Text) return widget.data ?? widget.textSpan?.toPlainText();
  if (widget is RichText) return widget.text.toPlainText();
  if (widget is EditableText) return widget.controller.text;
  return null;
}`;

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')
    .replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}
