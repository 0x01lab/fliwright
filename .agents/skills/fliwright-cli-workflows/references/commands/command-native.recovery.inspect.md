---
command: "native.recovery.inspect"
group: native
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright native recovery inspect

Read the selected device’s local lease, quarantine and recovery evidence without modifying it.

## When to use

Use after unconfirmed cleanup or an abandoned owner to identify live processes, retained records and the exact evidence fingerprint before recovery work.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Resolves the explicit native platform/device from project/environment or structured input. No Flutter VM URL or online device is required.
- For an Android Emulator lease acquired by stable AVD name, supply native.deviceId as avd:<name> through structured input for this offline command. A raw emulator serial selects a different local lease key; absence there does not prove the AVD lease is available. Inspection never runs ADB to discover the mapping. Online doctor/snapshot/run still require the actual device serial.
- Never creates lease storage, acquires ownership, boots, stops, installs or starts a Runner. Reads only this device’s known local lease records and bounded host process inventory.
- Symlinks, hard-linked files, nonregular/oversized/malformed records and unknown entries are retained and reported. Original journal contents, tokens and host paths are not returned.
- Exit 0 means inspection completed, including when issues are present. Process exit or absent local records do not prove platform cleanup. Do not delete records or replay unknown writes based on this output.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `native` | `--native` | object | no | — | Explicit native configuration object; otherwise resolved from project/environment. Includes platform, deviceId, targetAppId and optional backend/tools/iOS Runner product. Use structured input for objects. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Inspect local evidence for the configured device

```sh
fliwright native recovery inspect --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| schemaVersion | Local inspection report version 1. |
| deviceKey | Host/platform/device digest; raw device identity is not repeated. |
| fingerprint | Digest of this local evidence inventory. It is not a restoration receipt or proof of device readiness. |
| state | available, owned, quarantined, recovery-required or recovering; local evidence state only. |
| owner / delegate / operation / hostTool / recovery | absent, live, exited or invalid local process evidence. hostTool aggregates operation, lease-lifetime and delegated host process-group journals; exited groups and zombie rows are not active work. |
| quarantine / appRecord / permissionRecord / deviceRecord | absent, present or invalid. Present means readable bounded JSON. Android schema, device/owner/install binding and permission-state semantics are checked through issues; live device baseline/readback remains separate. |
| issues | Fixed diagnostics for invalid, legacy, changed or inconsistent records. invalid-device-record and inconsistent-device-record report malformed or mismatched Android device evidence. incomplete-android-installation means a permission record lacks an installation digest or companion app record. No saved error text or credentials. |

## Effects and failure handling

Registry effects: `local-runtime-read`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "native": {
      "type": "object",
      "properties": {
        "enabled": {
          "type": "boolean"
        },
        "platform": {
          "type": "string",
          "enum": [
            "android",
            "ios"
          ]
        },
        "deviceId": {
          "type": "string",
          "minLength": 1
        },
        "targetAppId": {
          "type": "string",
          "minLength": 1
        },
        "backend": {
          "type": "string",
          "enum": [
            "adb",
            "xctest"
          ]
        },
        "systemAppIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "externalAppIds": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "timeoutMs": {
          "type": "integer",
          "exclusiveMinimum": 0
        },
        "cleanupTimeoutMs": {
          "type": "integer",
          "exclusiveMinimum": 0
        },
        "tools": {
          "type": "object",
          "properties": {
            "adb": {
              "type": "string",
              "minLength": 1
            },
            "apkAnalyzer": {
              "type": "string",
              "minLength": 1
            },
            "xcrun": {
              "type": "string",
              "minLength": 1
            },
            "xcodebuild": {
              "type": "string",
              "minLength": 1
            }
          },
          "additionalProperties": false
        },
        "fingerprints": {
          "type": "object",
          "properties": {
            "enrolledId": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
            },
            "unenrolledId": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
            }
          },
          "required": [
            "enrolledId",
            "unenrolledId"
          ],
          "additionalProperties": false
        },
        "ios": {
          "type": "object",
          "properties": {
            "xctestrunPath": {
              "type": "string",
              "minLength": 1
            },
            "startupTimeoutMs": {
              "type": "integer",
              "exclusiveMinimum": 0
            }
          },
          "required": [
            "xctestrunPath"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "enabled",
        "platform",
        "deviceId",
        "targetAppId"
      ],
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema native.recovery.inspect --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [native doctor](./command-native.doctor.md) — Inspect the explicitly selected native device, installed target and platform prerequisites without starting a Runner.
- [native snapshot](./command-native.snapshot.md) — Capture an explicitly selected device’s native UI hierarchy using ADB or the owned XCTest Runner.
- [Command index](./index.md)
