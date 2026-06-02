---
module: "DartCodeGenerator"
package: "@fliwright/core"
source: "src/DartCodeGenerator.ts"
generated: "2026-06-02"
---

# DartCodeGenerator

> Generates Dart `integration_test` code from recorded operations.

## Overview

Generates a Dart file using `flutter_test` and `integration_test` packages with `testWidgets` blocks. Maps selectors to Dart Finder expressions (`find.text`, `find.byKey`, `find.bySemanticsLabel`, `find.byType`).

## Public Methods

### `generate(operations: RecordedOperation[], selectors: Map<number, string>, options?: CodegenOptions): string`

Generates Dart integration test code.

## Related

- **Used by:** [CodeGenerator](./CodeGenerator.md)
- **Source:** `src/DartCodeGenerator.ts`
