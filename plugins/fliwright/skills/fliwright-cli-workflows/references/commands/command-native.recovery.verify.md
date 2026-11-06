---
command: "native.recovery.verify"
group: native
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright native recovery verify

Compare an abandoned XCTest Runner journal with the selected iOS Simulator boot generation and launchd identity.

## When to use

Use after native recovery inspect reports an unresolved iOS Runner to diagnose retained processes and Simulator reboot changes.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Resolves an explicit iOS platform and Simulator UDID from project/environment or structured input. Android devices are rejected.
- Requires an owner-bound Runner recovery record and an exited owner, delegate, operation and host tool. Other inspection issues are rejected.
- Reads CoreSimulator lastBootedAt for the exact booted UDID and the exact XCTest Runner label from Simulator launchd.
- runner-matches-record compares a PID and boot timestamp only. PID reuse within one boot remains possible, so this result cannot establish process ownership or recovered device state.
- This online read-only check does not acquire a lease or recovery claim, start a Runner, terminate a process, modify evidence or clear quarantine. Re-run immediately before any future restore because evidence can change after readback.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `native` | `--native` | object | no | — | Explicit native configuration; must select iOS. Omission resolves project/environment configuration. |
| `timeout` | `--timeout` | integer | no | — | Total millisecond budget for Simulator boot-generation and XCTest Runner process readback. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Verify the configured Simulator Runner

```sh
fliwright native recovery verify --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| status | runner-absent, runner-matches-record or runner-mismatch. |
| recordedBootGenerationMatches | Whether CoreSimulator lastBootedAt matches the journal; this alone does not prove a live PID belongs to the Runner. |

## Effects and failure handling

Registry effects: `device-read`. These are coarse declarations; the behavior section explains actual reads/writes.

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

Refresh the installed contract with `fliwright schema native.recovery.verify --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [native recovery inspect](./command-native.recovery.inspect.md) — Read the selected device’s local lease, quarantine and recovery evidence without modifying it.
- [native doctor](./command-native.doctor.md) — Inspect the explicitly selected native device, installed target and platform prerequisites without starting a Runner.
- [Command index](./index.md)
