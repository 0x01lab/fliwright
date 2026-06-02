---
module: "CodeGenerator"
package: "@fliwright/core"
source: "src/CodeGenerator.ts"
tests: "tests/CodeGenerator.test.ts"
generated: "2026-06-02"
---

# CodeGenerator

> Emit a Vitest test file from a list of recorded operations and resolved selectors.

## Overview

For `lang: 'ts'` (default), generates `import { test, expect } from '@fliwright/vitest';` followed by a single `test('...', async ({ page }) => { ... })` block. Each operation maps to one statement:

| Operation | Output |
|-----------|--------|
| `tap` | `await page.locator(...).click();` |
| `longPress` | `await page.locator(...).longPress({ duration: ... });` |
| `drag` | `await page.locator(...).drag(deltaX, deltaY);` |
| `type` (action: `replace`) | `await page.locator(...).fill('text');` |
| `type` (default) | `await page.locator(...).type('text');` |

Delegates to [DartCodeGenerator](./DartCodeGenerator.md) when `options.lang === 'dart'`.

## Constructor

```typescript
constructor()
```

## Public Methods

### `generate(operations, selectors, options?): string`

| Parameter | Type | Description |
|-----------|------|-------------|
| `operations` | `RecordedOperation[]` | Recorded operations |
| `selectors` | `Map<number, string>` | Index → selector string |
| `options.lang` | `'ts' \| 'dart'` | Output language |
| `options.testName` | string | Test name (default `'recorded test'`) |
| `options.imports` | string | Override import source (default `@fliwright/vitest`) |

**Returns:** `string` — full source file.

## Example

```typescript
const code = new CodeGenerator().generate(operations, selectors, {
  testName: 'login flow',
});
```

## Related

- **Source:** `packages/fliwright-core/src/CodeGenerator.ts`
