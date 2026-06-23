# Fliwright TDD Mode — Developer Start Guide

This guide covers the current minimal TDD runtime: persistent MCP-owned runtime,
baseline reset, focused Vitest rerun, and attach/daemon app sync.

## Build

`@fliwright/mcp` depends on the published package entry of `@fliwright/tdd`, so
build TDD before running MCP from compiled output:

```bash
pnpm --filter @fliwright/tdd build
pnpm --filter @fliwright/mcp build
```

For tests, MCP aliases `@fliwright/tdd` to source and does not require a prior
TDD build.

## Attach Mode

Use this when a Flutter app is already running and you have a VM service URL.
The TDD runtime owns one driver for baseline reset, and Vitest fixtures receive
`FLIWRIGHT_VM_SERVICE_URL` so ordinary `@fliwright/vitest` tests connect to the
same app VM service.

Call MCP tools in this order:

```json
{
  "tool": "fliwright_tdd_start",
  "arguments": {
    "configRoot": "/absolute/path/to/vitest.config.ts",
    "vmServiceUrl": "ws://127.0.0.1:12345/abc=/ws",
    "scenario": {
      "homeRoute": "/",
      "resetCategories": ["navigation", "mock"]
    }
  }
}
```

```json
{
  "tool": "fliwright_tdd_focus",
  "arguments": {
    "file": "/absolute/path/to/.fliwright/tests/example.test.ts",
    "testName": "shows the expected state"
  }
}
```

```json
{
  "tool": "fliwright_tdd_cycle",
  "arguments": {
    "sync": "none"
  }
}
```

Use `"sync": "reload"` in attach mode for VM-service hot reload. Use
`"sync": "restart"` only with a daemon-started app.

Stop when done:

```json
{
  "tool": "fliwright_tdd_stop",
  "arguments": {
    "keepAppAlive": true
  }
}
```

## Daemon Start Mode

Use this when the runtime should launch the app through `flutter daemon`:

```json
{
  "tool": "fliwright_tdd_start",
  "arguments": {
    "configRoot": "/absolute/path/to/vitest.config.ts",
    "deviceId": "emulator-5554",
    "target": "lib/main.dart",
    "projectId": "/absolute/path/to/flutter_app",
    "scenario": {
      "homeRoute": "/",
      "resetCategories": ["navigation", "mock"]
    }
  }
}
```

Then use `fliwright_tdd_focus` and `fliwright_tdd_cycle`. Daemon mode supports
`"sync": "reload"` and `"sync": "restart"` when the daemon reports restart
support.

## Current Limit

Vitest 2.1.9 runs tests through worker processes. A live `FliwrightDriver`
object cannot be passed across that boundary, so fixture sharing is currently
`vm-service-url`, not `in-process-provider`. Runtime snapshots include
`fixtureDriverSharing` and explanatory `notes` so agents do not mistake this for
true single-object driver sharing.

## Baseline Reset

Built-in reset categories:

- `navigation`: `page.resetToHome({ homeRoute })`
- `mock`: `mock.clear()` and `mock.clearCalls()`

Other categories are reported in `unsupportedState` until an adapter is
registered in a follow-up implementation.
