---
module: "sandbox"
package: "@fliwright/vscode"
source: "src/sandbox/"
generated: "2026-06-02"
---

# Sandbox

> Manage `.fliwright/mocks/` config files and apply rules to the running Flutter app's mock server.

## Overview

The sandbox subsystem lets you flip between pre-defined mock responses (success, empty, server_error, etc.) for each HTTP endpoint without editing code. `MockConfigService` reads/writes the config files; `SandboxService` talks to the running app via the bridge's mock-server RPCs to apply rules.

## Modules

| File | Role |
|------|------|
| `src/sandbox/MockConfigService.ts` | Read/write `mock-index.json` and per-endpoint configs |
| `src/sandbox/SandboxService.ts` | Apply / clear mock routes via the connected driver |

## Commands

| Command | Action |
|---------|--------|
| `fliwright.reloadMocks` | Re-read configs from disk and refresh the Mock APIs tree |
| `fliwright.createMockConfig` | Open a QuickPick to scaffold a new mock config |
| `fliwright.openMockConfig` | Open the selected config file in the editor |
| `fliwright.copyMockEndpoint` | Copy an endpoint path to clipboard |
| `fliwright.copyMockRuleJson` | Copy a rule as JSON for pasting elsewhere |
| `fliwright.applyMockRule` | Apply the selected rule to the running app |
| `fliwright.applyDefaultMocks` | Apply every endpoint's default rule |
| `fliwright.stopSandbox` | Clear all mock routes (passthrough) |

## Related

- **Source:** `packages/fliwright-vscode/src/sandbox/`
