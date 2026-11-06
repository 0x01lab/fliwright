---
command: "native.prepare"
group: native
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright native prepare

Explicitly build or reuse the unsigned iOS Simulator XCTest Runner in the local build cache.

## When to use

Use on macOS with Xcode before configuring native.ios.xctestrunPath. This is the build workflow; doctor never builds implicitly.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires macOS and Xcode. It prepares Simulator products only; physical iOS signing and transport remain unsupported.
- Does not boot, erase or launch any target app. Uses a shared build lock and cancellable bounded tools.
- Default timeout is 300000ms. cacheRoot overrides the local cache directory; no build products or machine paths belong in version control.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `cacheRoot` | `--cache-root` | string | no | — | Local Runner build cache directory; defaults to ~/.fliwright/native/ios-runners. Keep generated products outside version control. (minLength=1) |
| `timeout` | `--timeout` | integer | no | — | Milliseconds for the test runner, target wait or extended action, depending on the command. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Prepare or reuse the current Simulator Runner

```sh
fliwright native prepare --json
```

### Set the build budget

```sh
fliwright native prepare --timeout '300000' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| xctestrunPath | Existing product to reference from local native configuration. |
| cached | True when source/toolchain/architecture/signing inputs match and actual executables exist. |
| cacheKey | Digest of build inputs. |
| xcode | Detected Xcode build version. |
| sdkBuild | Detected iOS Simulator SDK build. |

## Effects and failure handling

Registry effects: `runner-build`, `build-cache`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "cacheRoot": {
      "type": "string",
      "minLength": 1
    },
    "timeout": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema native.prepare --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [native doctor](./command-native.doctor.md) — Inspect the explicitly selected native device, installed target and platform prerequisites without starting a Runner.
- [native snapshot](./command-native.snapshot.md) — Capture an explicitly selected device’s native UI hierarchy using ADB or the owned XCTest Runner.
- [Command index](./index.md)
