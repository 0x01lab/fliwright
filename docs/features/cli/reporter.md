---
module: "reporter"
package: "@fliwright/cli"
source: "src/reporter.ts"
generated: "2026-06-02"
---

# `reporter`

> Three output formatters (`pretty`, `json`, `junit`) that render a `CliRunResult` for terminals, CI artifacts, and JUnit-compatible dashboards.

## Overview

Each formatter is a pure function from `CliRunResult` to a string. The CLI's [run command](./run.md) selects one based on the `--reporter` flag (or `config.reporter`). `pretty` uses `chalk` for colored pass/fail icons; `json` produces 2-space-indented JSON; `junit` emits a `testsuites` XML document with proper entity escaping.

## Signature

```typescript
export interface CliTestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface CliRunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: CliTestResult[];
}

export function formatPretty(result: CliRunResult): string;
export function formatJson(result: CliRunResult): string;
export function formatJunit(result: CliRunResult): string;
```

## Public Methods

### `formatPretty(result): string`

Renders passed tests first (green `OK` icons), then failed tests (red `X` icons) with the first line of `error` underneath in gray. Closes with a summary line: `Results: <passed> passed, <failed> failed (<duration>ms)`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `result` | `CliRunResult` | Yes | Aggregated test run output. |

**Returns:** `string` — multiline terminal-friendly output with ANSI color codes.

---

### `formatJson(result): string`

Pretty-prints the full `CliRunResult` as JSON with 2-space indentation. Suitable for machine consumption or piping into other tools.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `result` | `CliRunResult` | Yes | Aggregated test run output. |

**Returns:** `string` — JSON document.

---

### `formatJunit(result): string`

Produces JUnit-style XML. Escapes `&`, `<`, `>`, `"` in test names and error messages. Failed tests get a `<failure message="...">` child containing the first line of `error`. The single `testsuite` is named `fliwright`; `tests` and `failures` counters and `time` (in seconds) are populated from the result.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `result` | `CliRunResult` | Yes | Aggregated test run output. |

**Returns:** `string` — XML document starting with `<?xml version="1.0" encoding="UTF-8"?>`.

## Example

```typescript
import { formatPretty, formatJson, formatJunit, type CliRunResult } from '@fliwright/cli';

const result: CliRunResult = {
  passed: false,
  totalTests: 2,
  passedTests: 1,
  failedTests: 1,
  duration: 410,
  results: [
    { name: 'login', passed: true, duration: 120 },
    { name: 'logout', passed: false, duration: 290, error: 'Element not found: text=Sign out' },
  ],
};

console.log(formatPretty(result));
console.log(formatJson(result));
console.log(formatJunit(result));
```

Sample JUnit output:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
<testsuite name="fliwright" tests="2" failures="1" time="0.410">
  <testcase name="login" time="0.120" />
  <testcase name="logout" time="0.290">
    <failure message="Element not found: text=Sign out" />
  </testcase>
</testsuite>
</testsuites>
```

## Related

- **Depends on:** `chalk` (`^5.3.0`)
- **Used by:** [run command](./run.md)
- **Source:** `packages/fliwright-cli/src/reporter.ts`
