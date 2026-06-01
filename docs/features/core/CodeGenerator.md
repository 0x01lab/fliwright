---
module: "CodeGenerator"
package: "@fliwright/core"
source: "src/CodeGenerator.ts"
generated: "2026-06-01"
---

# CodeGenerator

> Generates Vitest-style TypeScript test code from recorded operations.

## Overview

`CodeGenerator` takes a list of `RecordedOperation` entries and resolved selectors, and produces runnable TypeScript test code using `@fliwright/vitest`. When `options.lang === 'dart'`, it delegates to `DartCodeGenerator`.

## Constructor

```typescript
constructor()
```

## Public Methods

### `generate(operations: RecordedOperation[], selectors: Map<number, string>, options?: CodegenOptions): string`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operations` | `RecordedOperation[]` | Yes | Recorded operations |
| `selectors` | `Map<number, string>` | Yes | Resolved selectors keyed by operation index |
| `options` | `CodegenOptions` | No | Test name, imports, language |

**Returns:** `string` — Generated test code

## Related

- **Used by:** [RecorderController](./RecorderController.md)
- **Source:** `src/CodeGenerator.ts`
