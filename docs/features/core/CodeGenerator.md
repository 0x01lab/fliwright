---
module: "CodeGenerator"
package: "@fliwright/core"
source: "src/CodeGenerator.ts"
generated: "2026-06-02"
---

# CodeGenerator

> Generates TypeScript test code from recorded operations.

## Overview

`CodeGenerator` takes `RecordedOperation[]` and a selector map, then outputs a complete `@fliwright/vitest` test file. Supports both TypeScript (default) and Dart via `DartCodeGenerator`.

## Public Methods

### `generate(operations: RecordedOperation[], selectors: Map<number, string>, options?: CodegenOptions): string`

Generates test code. When `options.lang === 'dart'`, delegates to `DartCodeGenerator`. Otherwise generates TypeScript using `@fliwright/vitest` imports.

## Related

- **Depends on:** [DartCodeGenerator](./DartCodeGenerator.md)
- **Used by:** [RecorderController](./RecorderController.md)
- **Source:** `src/CodeGenerator.ts`
