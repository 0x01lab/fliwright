---
command: "native.recovery.restore"
group: native
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright native recovery restore

Restore the exact isolated resource recorded for an abandoned iOS Simulator or Android Emulator lease.

## When to use

Use after native recovery inspect reports quarantined or recovery-required. Inspect the returned fingerprint immediately before restore. iOS Runner restore uses authenticated Runner shutdown; Android restore requires native.deviceId=avd:<name> and one online AVD whose serial matches the owner-bound device record.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Requires the exact current fingerprint from native recovery inspect. Any intervening local evidence change refuses the operation.
- Only isolated, owner-bound evidence with exited owner/delegate/operation/host tools and no unrelated unresolved resources is accepted. Physical iOS and physical Android are rejected.
- Android discovery must be complete and resolve exactly one online Emulator with the configured AVD name. Its serial digest must match the saved device binding; callers cannot override the serial.
- Android readback checks boot/OS, package/APK/UID, user, target SDK, process state, camera/microphone permission grants and flags, default app-op and the exact recorded forward mapping. It force-stops the target, restores recorded permissions, removes only the owned forward and uninstalls only an app installed by that session.
- Recovery writes have durable pending intents and independent readback. Unknown write outcomes are never replayed automatically; failed or cancelled work retains the original evidence and device exclusion.
- The Android recovery path has host contract and SIGKILL takeover tests but has not yet passed device-backed acceptance on a dedicated AVD. Do not treat the implementation as a supported Android recovery guarantee until that evidence is recorded.
- A successful receipt proves only its resourceScope was restored. It does not establish general device readiness or support for biometric injection, gallery import or camera-frame replacement.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `native` | `--native` | object | no | — | Explicit native configuration; iOS selects a Simulator, Android must use the stable AVD identity avd:<name>. Omission resolves project/environment configuration. |
| `fingerprint` | `--fingerprint` | string | yes | — | Exact current fingerprint returned by native recovery inspect. Any intervening evidence change makes it stale. (pattern=^[a-f0-9]{64}$) |
| `timeout` | `--timeout` | integer | no | — | Total millisecond budget for device discovery where needed, platform readback, recovery writes and durable archival. (exclusiveMinimum=0) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Restore the exact inspected iOS Runner

```sh
cat > 'fliwright-native.recovery.restore-input.json' <<'JSON'
{
  "native": {
    "enabled": false,
    "platform": "ios",
    "deviceId": "SIMULATOR_UDID",
    "targetAppId": "example.app"
  },
  "fingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
JSON
fliwright native recovery restore --input 'fliwright-native.recovery.restore-input.json' --json
```

### Restore the exact inspected Android Emulator lease

```sh
cat > 'fliwright-native.recovery.restore-input.json' <<'JSON'
{
  "native": {
    "enabled": false,
    "platform": "android",
    "deviceId": "avd:dedicated-test",
    "targetAppId": "example.app"
  },
  "fingerprint": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
JSON
fliwright native recovery restore --input 'fliwright-native.recovery.restore-input.json' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| status | restored only after platform readback, durable completion, original lock/quarantine archival and reservation retirement. |
| transactionId | Opaque recovery transaction identifier; no journal, key, PID, serial or archive path is returned. |
| resourceScope | iOS: xctest-runner. Android: android-app-permission-forward. Android restore does not restore the Flutter app installation unless this attempt installed it; it never resets unrelated forwards. |

## Effects and failure handling

Registry effects: `device-lease`, `device-write`, `native-runner-recovery`, `native-app-permission-forward-recovery`, `recovery-archive`. These are coarse declarations; the behavior section explains actual reads/writes.

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
    "fingerprint": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "timeout": {
      "type": "integer",
      "exclusiveMinimum": 0
    }
  },
  "required": [
    "fingerprint"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema native.recovery.restore --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [native recovery inspect](./command-native.recovery.inspect.md) — Read the selected device’s local lease, quarantine and recovery evidence without modifying it.
- [native recovery verify](./command-native.recovery.verify.md) — Compare an abandoned XCTest Runner journal with the selected iOS Simulator boot generation and launchd identity.
- [Command index](./index.md)
