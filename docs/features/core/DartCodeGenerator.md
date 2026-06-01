---
module: "DartCodeGenerator"
package: "@fliwright/core"
source: "src/DartCodeGenerator.ts"
generated: "2026-06-01"
---

# DartCodeGenerator

> Generates Dart integration_test code from recorded operations.

## Overview

`DartCodeGenerator` produces `flutter_test`/`integration_test` style Dart code from recorded operations. It maps selectors to Dart finder expressions (e.g., `find.byType`, `find.byText`).

## Constructor

```typescript
constructor()
```

## Public Methods

### `generate(operations: RecordedOperation[], selectors: Map<number, string>, options?: CodegenOptions): string`

**Returns:** `string` — Generated Dart test code

## Related

- **Used by:** [CodeGenerator](./CodeGenerator.md) (delegation)
- **Source:** `src/DartCodeGenerator.ts`
