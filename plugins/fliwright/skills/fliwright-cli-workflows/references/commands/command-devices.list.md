---
command: "devices.list"
group: setup
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright devices list

Discover local iOS and Android physical devices and simulators without a running app.

## When to use

Use before choosing a device ID for a managed launch. Detection runs on the CLI host and does not use an inherited connection session.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- By default scans Android and, on macOS, iOS. Explicit iOS scans on other hosts return an unsupported-host diagnostic.
- Requires Android platform-tools/emulator or Xcode. ANDROID_HOME, ANDROID_SDK_ROOT and standard SDK locations resolve Android executables.
- Exit 0 means the scan completed; inspect diagnostics for partial detection. It does not boot, erase, pair or unlock devices.
- An AVD is marked unknown if an offline or unidentified running emulator prevents proving it is stopped. Physical iOS devices unavailable to Xcode include a diagnostic detail.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `platform` | `--platform` | "ios" \| "android" | no | — | Limit local device detection to iOS or Android. Omit to scan the platforms supported by this host. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### List host devices

```sh
fliwright devices list --json
```

### List Android devices

```sh
fliwright devices list --platform 'android' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| devices[] | Native id, name, platform, kind, state and available OS/model information. Stopped Android AVD ids use avd:<name>; these cannot be passed to app launch. |
| diagnostics[] | Missing tools, failed commands, invalid output or unsupported host; other sources still return results. |
| scannedAt | ISO timestamp when the scan completed. |

## Effects and failure handling

Registry effects: `environment-probe`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "platform": {
      "type": "string",
      "enum": [
        "ios",
        "android"
      ]
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema devices.list --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [doctor](./command-doctor.md) — Check local tooling, configuration and the Flutter automation connection.
- [Command index](./index.md)
