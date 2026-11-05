---
command: "native.doctor"
group: native
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright native doctor

Inspect the explicitly selected native device, installed target and platform prerequisites without starting a Runner.

## When to use

Use before native tests to distinguish missing tools, unauthorized devices, a missing target app and an unprepared iOS Runner.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires native configuration in fliwright.config.ts, a FLIWRIGHT_CONFIG_PATH snapshot or structured input, including explicit platform/deviceId/targetAppId.
- Never boots, erases, installs, builds or starts XCTest. No Flutter VM URL or connection session is used.
- --strict exits 3 when prerequisites are not ready and retains the diagnostic data.
- Physical Face ID/fingerprint injection is unsupported; iOS Simulator injection remains unverified.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `native` | `--native` | object | no | — | Explicit native configuration object; otherwise resolved from project/environment. Includes platform, deviceId, targetAppId and optional backend/tools/iOS Runner product. Use structured input for objects. |
| `strict` | `--strict` | boolean | no | — | Fail doctor if any required check failed or was skipped. |
| `timeout` | `--timeout` | integer | no | — | Milliseconds for the test runner, target wait or extended action, depending on the command. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Check project native prerequisites

```sh
fliwright native doctor --json
```

### Fail CI on unmet prerequisites

```sh
fliwright native doctor --strict 'true' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| ready | Environment prerequisites passed; this does not prove a live Runner handshake or a successful biometric challenge. |
| checks | Named prerequisite results and actionable failures. |
| capabilities | Per-capability support and readiness; iOS operations remain not ready until a Runner handshake. |
| diagnostics | Device discovery tool diagnostics. |
| runnerStarted | Always false for this read-only command. |

## Effects and failure handling

Registry effects: `environment-probe`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "strict": {
      "type": "boolean"
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

Refresh the installed contract with `fliwright schema native.doctor --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [native prepare](./command-native.prepare.md) — Explicitly build or reuse the unsigned iOS Simulator XCTest Runner in the local build cache.
- [native snapshot](./command-native.snapshot.md) — Capture an explicitly selected device’s native UI hierarchy using ADB or the owned XCTest Runner.
- [devices list](./command-devices.list.md) — Discover local iOS and Android physical devices and simulators without a running app.
- [Command index](./index.md)
