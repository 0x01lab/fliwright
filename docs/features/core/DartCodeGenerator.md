---
module: "DartCodeGenerator"
package: "@fliwright/core"
source: "src/DartCodeGenerator.ts"
tests: "tests/DartCodeGenerator.test.ts"
generated: "2026-06-02"
---

# DartCodeGenerator

> Emit a Flutter `integration_test` Dart file from recorded operations and selectors.

## Overview

Produces a `void main() { IntegrationTestWidgetsFlutterBinding.ensureInitialized(); testWidgets('...', (tester) async { ... }); }` skeleton. Selectors are converted to Dart `find.*` calls in priority order:

| Selector | Dart finder |
|----------|-------------|
| `text='X'` | `find.text('X')` |
| `key='X'` | `find.byKey(const Key('X'))` |
| `role='X'` | `find.bySemanticsLabel('X')` |
| `type='X'` | `find.byType(X)` |
| (none) | `find.byType(Widget)` |

Each operation emits the corresponding `tester.tap` / `tester.longPress` / `tester.drag` / `tester.enterText` plus `await tester.pumpAndSettle();`.

## Constructor

```typescript
constructor()
```

## Public Methods

### `generate(operations, selectors, options?): string`

| Parameter | Type | Description |
|-----------|------|-------------|
| `operations` | `RecordedOperation[]` | Recorded ops |
| `selectors` | `Map<number, string>` | Index → selector |
| `options.testName` | string | Test name |

**Returns:** `string` — Dart source.

## Example

```typescript
const dart = new DartCodeGenerator().generate(operations, selectors, {
  testName: 'login flow',
});
```

## Related

- **Source:** `packages/fliwright-core/src/DartCodeGenerator.ts`
