---
package: "@fliwright/plugin-riverpod"
version: "0.1.0"
layer: plugin
status: implemented
generated: "2026-06-01"
---

# @fliwright/plugin-riverpod

> Riverpod state management plugin — exposes provider read/write/watch/override to Fliwright tests.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `RiverpodStateAdapter` | State adapter for Riverpod providers | [RiverpodStateAdapter.md](./RiverpodStateAdapter.md) |

## Dependencies

- `@fliwright/core` — workspace:*

## Usage Example

```typescript
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';

const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });
await driver.connect('ws://localhost:12345/ws');

// Read a provider value
const count = await driver.state.read('counterProvider');

// Override a provider
await driver.state.override('counterProvider', 42);

// List all providers
const providers = await driver.state.listProviders();
```
