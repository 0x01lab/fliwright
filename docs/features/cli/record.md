---
module: "recordCommand"
package: "@fliwright/cli"
source: "src/commands/record.ts"
generated: "2026-06-02"
---

# `fliwright record`

> Records live user interactions on a running Flutter app and emits a TypeScript or Dart test file with optional assertion suggestions appended as comments.

## Overview

`recordCommand` connects a `FliwrightDriver` to the resolved VM Service URL, calls `driver.recorder.start({ onOperation })` to begin capturing pointer and text events, and waits for either SIGINT (Ctrl+C) or a `stopSignal` promise (for testing). On stop, it calls `recorder.stop(codegenOptions)` to produce test code, runs `AssertionSuggester.suggest(operations)` for follow-on assertion ideas, appends suggestions as comments, and either writes the result to `--output` or prints it to stdout.

## Signature

```typescript
export interface RecordOptions {
  vmUrl?: string;
  output?: string;
  lang?: 'ts' | 'dart';
  testName?: string;
  cwd?: string;
}

export interface RecordResult {
  code: string;
  operations: RecordedOperation[];
}

export interface RecorderLike {
  start: (options?: { onOperation?: (op: RecordedOperation, idx: number) => void }) => Promise<void>;
  stop: (options?: CodegenOptions) => Promise<string>;
  getOperations: () => RecordedOperation[];
}

export interface RecordDeps {
  resolveVmUrl?: (options: { cliFlag?: string; configUrl?: string }) => Promise<string | null>;
  createRecorder?: (vmUrl: string) => Promise<RecorderLike>;
  stopSignal?: Promise<void>; // testing hook
}

export async function recordCommand(
  options: RecordOptions,
  deps?: RecordDeps,
): Promise<RecordResult>;
```

## Flags

| Flag | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `--vm-url <url>` | `string` | No | Resolved via [vm-discovery](./vm-discovery.md) | Dart VM Service WebSocket URL. |
| `--output <file>` | `string` | No | stdout | File path to write the generated test. |
| `--lang <lang>` | `'ts' \| 'dart'` | No | `'ts'` | Output language for code generation. |
| `--name <name>` | `string` | No | `'recorded test'` | Test name used in the generated `test(...)` block. |

## Output

While recording, each captured operation streams to stdout:

```
🔴 Recording... Press Ctrl+C to stop.

  1. click (320, 480)
  2. type "leo@example.com" (320, 540)
  3. click (320, 640)
```

On stop (Ctrl+C), the generated test is either printed under a `--- Generated Test Code ---` header or written to `--output`. If `AssertionSuggester` produced suggestions, they're appended as a trailing comment block:

```typescript
// Assertion Suggestions:
  // Suggested assertion (text-stable-after-click)
  //   await expect(page.locator('text=Welcome')).toBeVisible();
```

The CLI binary in `src/index.ts` calls `process.exit(1)` if `recordCommand` throws (e.g. no VM Service URL resolved).

## Examples

```bash
# Record, write TypeScript to stdout, stop with Ctrl+C
npx fliwright record

# Record Dart code into a file
npx fliwright record --lang dart --output tests/recorded.dart --name "login flow"
```

Programmatic (with a fake recorder for testing):

```typescript
import { recordCommand } from '@fliwright/cli';

const { code, operations } = await recordCommand(
  { lang: 'ts', testName: 'signin', vmUrl: 'ws://127.0.0.1:8181/ws' },
  {
    createRecorder: async () => fakeRecorder,
    stopSignal: somePromiseThatResolvesOnDone,
  },
);
```

## Lifecycle

1. **Resolve VM URL** — uses `resolveVmUrl({ cliFlag: options.vmUrl })`. Throws if null.
2. **Build recorder** — `defaultCreateRecorder(vmUrl)` does `new FliwrightDriver()` + `connect()` and returns `driver.recorder`. Override via `deps.createRecorder` for tests.
3. **Start** — `recorder.start({ onOperation })` — the callback logs each op (kind, text, position) as it's captured.
4. **Wait** — `stopSignal` if provided, otherwise `waitForSigint()` which listens for `SIGINT` and cleans up the listener.
5. **Stop** — `recorder.stop({ lang, testName })` returns generated code as a string.
6. **Suggest** — `AssertionSuggester.suggest(operations)` produces `{ template, reason }[]`; non-empty lists are appended as commented `// Suggested assertion (...)` lines.
7. **Emit** — `writeFile(options.output, finalCode)` if `--output` set; otherwise `console.log`.

## Related

- **Depends on:** [vm-discovery](./vm-discovery.md), `@fliwright/core` [`FliwrightDriver`](../core/FliwrightDriver.md), [`RecorderController`](../core/RecorderController.md), [`AssertionSuggester`](../core/AssertionSuggester.md)
- **See also:** [recording-pipeline.md](../recording-pipeline.md) for the end-to-end recording & codegen flow
- **Source:** `packages/fliwright-cli/src/commands/record.ts`
