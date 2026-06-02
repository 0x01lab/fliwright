---
module: "MockRuleStore"
package: "@fliwright/core"
source: "src/MockRuleStore.ts"
generated: "2026-06-02"
---

# MockRuleStore

> Loads and manages named mock rules from `.fliwright/mocks/` JSON configuration files.

## Overview

`MockRuleStore` reads `mock-index.json` for file list and default rule, or auto-discovers `api/*.json` files. Each endpoint config defines named rules (e.g., "success", "error", "empty") that can be switched at runtime.

## Public Methods

### `loadFromDirectory(mockDir: string): Promise<void>`

Loads all mock configurations from a directory. Reads `mock-index.json` if present, otherwise scans `api/*.json`.

### `listEndpoints(): Array<{ endpoint, method, rules[], activeRule }>`

Lists all registered endpoints with their rule names and active selection.

### `getActiveResponse(endpoint: string): MockRouteResponse | null`

Returns the response for the currently active rule of an endpoint.

### `switchRule(endpoint: string, ruleName: string): MockRouteResponse | null`

Switches the active rule. Throws if endpoint or rule not found.

### `isLoaded` (getter)

Returns `true` if any rules have been loaded.

## Related

- **Used by:** [ToolMockServer](./ToolMockServer.md), [MockManager](./MockManager.md)
- **Source:** `src/MockRuleStore.ts`
