---
module: "reporter"
package: "@fliwright/vitest"
source: "src/reporter.ts"
generated: "2026-06-02"
---

# `FliwrightReporter`

> Vitest `Reporter` implementation that scans failed-test error stacks and prints the path of any screenshot captured under `.fliwright/failures/`.

## Overview

When a Fliwright test fails, the `FailureCollector` writes a PNG to `.fliwright/failures/<id>.png` and embeds the path in the assertion stack trace. `FliwrightReporter` walks the per-test `errors[].stack` of every Vitest `File`, finds those paths via regex, and prints them as `Screenshot: .fliwright/failures/...` lines under the standard Vitest output. This gives humans (and downstream tooling) a clickable pointer to the captured screenshot.

## Signature

```typescript
import type { Reporter, File } from 'vitest';

export class FliwrightReporter implements Reporter {
  onInit(): void;
  onFinished(files: File[]): void;
}
```

## Public Methods

### `onInit(): void`

No-op. Required by the `Reporter` interface; called by Vitest when the reporter is registered.

---

### `onFinished(files: File[]): void`

Iterates every `File.tasks` of type `'test'` whose `result.state === 'fail'`, scans each error's `stack` for the pattern `/\.fliwright\/failures\/[^\s]+\.png/`, and prints matching paths to stdout.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | `File[]` | Yes | Vitest's per-file result tree. |

**Returns:** `void`

**Example:**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { FliwrightReporter } from '@fliwright/vitest/reporter';

export default defineConfig({
  test: {
    reporters: ['default', new FliwrightReporter()],
  },
});
```

Sample output for a failed test:

\`\`\`
  Screenshot: .fliwright/failures/1234abc-counter-increments.png
\`\`\`

## Related

- **Depends on:** `vitest` (`Reporter`, `File` types)
- **Used by:** Vitest configurations that want failure screenshots surfaced in the terminal report
- **Companion modules:** [test.md](./test.md), [expect.md](./expect.md)
- **Source:** `packages/fliwright-vitest/src/reporter.ts`
