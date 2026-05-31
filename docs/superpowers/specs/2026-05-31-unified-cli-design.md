# Unified CLI + E2E Closed Loop Design

**Date**: 2026-05-31
**Status**: Approved
**Scope**: MVP → V1.0 transition

---

## 1. Context

Fliwright has completed its MVP core: `fliwright-bridge` (Dart VM Service extensions), `@fliwright/core` (TypeScript SDK), `@fliwright/mcp` (MCP server), and `@fliwright/vitest` (test integration). All fundamental capabilities—remote control, self-healing, form helper, mock environment, AI feedback—are implemented.

**Gap**: There is no unified CLI for developers to run tests locally or in CI. The current workflow requires manual VM Service URL extraction, environment variable setup, and direct `vitest` invocation. This design adds a `fliwright` CLI that wraps existing infrastructure, providing a streamlined developer experience.

---

## 2. New Package: `packages/fliwright-cli/`

```
packages/fliwright-cli/
├── src/
│   ├── index.ts            # Entry point + command dispatch (commander)
│   ├── commands/
│   │   ├── run.ts          # fliwright run
│   │   ├── init.ts         # fliwright init
│   │   └── doctor.ts       # fliwright doctor
│   ├── config.ts           # Configuration file loading
│   ├── vm-discovery.ts     # VM Service URL discovery
│   └── reporter.ts         # Structured result output
├── package.json
├── tsconfig.json
└── README.md
```

`package.json` registers the binary:

```json
{
  "name": "@fliwright/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "fliwright": "dist/index.js"
  }
}
```

---

## 3. Commands

### 3.1 `fliwright run`

```
fliwright run [--test <file|glob>] [--vm-url <url>] [--reporter <format>]
```

**Execution flow**:

1. Load configuration from `fliwright.config.ts` (if present)
2. Resolve VM Service URL (see §4)
3. Set `FLIWRIGHT_VM_URL` environment variable
4. Invoke Vitest via `execFileSync('node', [vitestBin, 'run', testPattern])`
5. Parse and report results

**Options**:

| Flag | Default | Description |
|------|---------|-------------|
| `--test` | `tests/**/*.test.ts` | Test file or glob pattern |
| `--vm-url` | (auto-discovered) | VM Service WebSocket URL |
| `--reporter` | `pretty` | Output format: `pretty`, `json`, `junit` |
| `--timeout` | 30000 | Per-test timeout in ms |
| `--screenshot` | `file` | Screenshot mode: `file`, `base64`, `off` |

### 3.2 `fliwright init`

Generates project scaffold:

1. `fliwright.config.ts` — project-level configuration
2. `tests/example.test.ts` — starter test file
3. Updates `package.json` with `@fliwright/cli` and `@fliwright/vitest` in devDependencies

### 3.3 `fliwright doctor`

Environment health check:

```
✅ Flutter SDK 3.22.0 at /usr/local/flutter
✅ Dart SDK 3.5.0
✅ Node.js 20.11.0
✅ @fliwright/core 0.1.0 installed
⚠️  No Flutter app detected (run `flutter run` to start one)
```

**Check items**:
- Flutter SDK ≥ 3.x
- Node.js ≥ 18
- `@fliwright/core` and `@fliwright/vitest` installed
- VM Service connectivity (if URL configured)
- `fliwright.config.ts` exists and parses correctly

---

## 4. VM Service URL Discovery

Resolution priority (first match wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | `--vm-url` CLI flag | Explicit, highest priority |
| 2 | `FLIWRIGHT_VM_URL` env var | Backward-compatible with existing E2E tests |
| 3 | `fliwright.config.ts` `vmServiceUrl` field | Project-level default |
| 4 | Auto-scan | Connect to known Observatory ports |

**Auto-scan implementation**:

```typescript
const SCAN_PORTS = [8181, 9189, 54321];

async function discoverVmServiceUrl(): Promise<string | null> {
  for (const port of SCAN_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return `ws://127.0.0.1:${port}/ws`;
    } catch { /* skip unreachable */ }
  }
  return null;
}
```

**Fallback error message** (when no URL found):

```
❌ Could not find a running Flutter VM Service.

   Start your Flutter app first: flutter run
   Then re-run: fliwright run
   Or specify explicitly: fliwright run --vm-url ws://127.0.0.1:8181/ws
```

---

## 5. Configuration File

`fliwright.config.ts` at project root:

```typescript
import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  vmServiceUrl: process.env.FLIWRIGHT_VM_URL,
  timeout: 30000,
  screenshot: 'file',
  testDir: 'tests',
  reporter: 'pretty',
});
```

`defineConfig` provides type safety and default values. The config loader uses `jiti` or dynamic import to handle TypeScript config files without pre-compilation.

---

## 6. Reporter Formats

### `pretty` (default)

Terminal-friendly table output with color-coded pass/fail:

```
✅ tests/login.test.ts
   ✅ should show login form (120ms)
   ✅ should validate credentials (340ms)

❌ tests/cart.test.ts
   ✅ should add item to cart (89ms)
   ❌ should update quantity (450ms)
      → AssertionError: Expected "text=Qty: 2" to be visible within 5000ms
      → Self-healing attempted: no match above threshold

Results: 3 passed, 1 failed (999ms)
```

### `json`

Structured output aligned with MCP `fliwright_run` return schema, for CI/Agent consumption.

### `junit`

JUnit XML format for CI system integration (GitHub Actions, Jenkins, etc.).

---

## 7. Dependencies

```
@fliwright/cli
  ├── @fliwright/core       (workspace:*)    — SDK types and constants
  ├── vitest                (peerDependency) — test runner
  ├── @fliwright/vitest     (peerDependency) — Vitest integration plugin
  ├── commander             (^12.0)          — CLI argument parsing
  ├── chalk                 (^5.0)           — Terminal coloring
  └── jiti                 (^2.0)           — TypeScript config loading
```

---

## 8. Relationship with MCP

CLI and MCP serve complementary roles. They do not duplicate functionality.

| Scenario | Tool |
|----------|------|
| Developer runs tests locally | `fliwright run` |
| CI/CD pipeline | `fliwright run --reporter junit` |
| AI Agent invokes tests | MCP `fliwright_run` tool |
| AI Agent retrieves failure context | MCP `fliwright_get_failure` tool |
| AI Agent generates tests | MCP `fliwright_generate_test` tool |

Both CLI and MCP use the same `@fliwright/vitest` plugin and failure context format, ensuring consistent behavior.

---

## 9. Implementation Order

1. **Package scaffold** — `package.json`, `tsconfig.json`, directory structure
2. **`vm-discovery.ts`** — URL discovery logic with auto-scan
3. **`config.ts`** — Config file loading with `defineConfig`
4. **`run` command** — Core `fliwright run` delegating to Vitest
5. **`init` command** — Project scaffolding
6. **`doctor` command** — Environment health check
7. **`reporter.ts`** — Pretty/JSON/JUnit output formatters
8. **Integration tests** — End-to-end test of the CLI itself
