---
command: "native.snapshot"
group: native
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright native snapshot

Capture an explicitly selected device’s native UI hierarchy using ADB or the owned XCTest Runner.

## When to use

Use to discover stable native IDs and system UI labels outside the Flutter widget tree.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires enabled native configuration with an online device and installed target app. A Flutter VM URL is not required.
- Acquires the shared device lease and releases the owned Adapter after capture, including on failure.
- iOS requires a product created by native prepare; snapshot starts a temporary XCTest session without launching or resetting the target app.
- Queries default to exact/app scope; system scopes and external apps are restricted to session allowlists. Missing accessibility nodes differ from transport errors.
- A full iOS tree may exceed the configured budget; use a scoped query. Password values are masked by platform normalization.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `native` | `--native` | object | no | — | Explicit native configuration object; otherwise resolved from project/environment. Includes platform, deviceId, targetAppId and optional backend/tools/iOS Runner product. Use structured input for objects. |
| `timeout` | `--timeout` | integer | no | — | Milliseconds for the test runner, target wait or extended action, depending on the command. (exclusiveMinimum=0) |
| `query` | `--query` | object | no | — | Native snapshot query: resourceId/text/label field, nonempty value, exact (default true) and app/system/allowlisted appId scope (default app). |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Capture the target app tree

```sh
fliwright native snapshot --json
```

### Inspect a system permission label

```sh
cat > 'fliwright-native.snapshot-input.json' <<'JSON'
{
  "query": {
    "field": "label",
    "value": "Allow",
    "exact": true,
    "scope": "system"
  }
}
JSON
fliwright native snapshot --input 'fliwright-native.snapshot-input.json' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| surface | native; distinct from Flutter widget snapshots. |
| schemaVersion | Native evidence wrapper version 1. |
| snapshot | Normalized native identity, generation, screen geometry and nodes. |
| query | Optional query pushed down to avoid expensive full-tree traversal, particularly on iOS. |

## Effects and failure handling

Registry effects: `device-lease`, `native-runner`, `owned-device-temp-files`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    },
    "query": {
      "type": "object",
      "properties": {
        "field": {
          "type": "string",
          "enum": [
            "resourceId",
            "text",
            "label"
          ]
        },
        "value": {
          "type": "string",
          "minLength": 1
        },
        "exact": {
          "type": "boolean",
          "default": true
        },
        "scope": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "app",
                "system"
              ]
            },
            {
              "type": "object",
              "properties": {
                "appId": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "appId"
              ],
              "additionalProperties": false
            }
          ],
          "default": "app"
        }
      },
      "required": [
        "field",
        "value"
      ],
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema native.snapshot --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [native doctor](./command-native.doctor.md) — Inspect the explicitly selected native device, installed target and platform prerequisites without starting a Runner.
- [native prepare](./command-native.prepare.md) — Explicitly build or reuse the unsigned iOS Simulator XCTest Runner in the local build cache.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
