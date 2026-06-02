---
package: "@fliwright/plugin-riverpod"
version: "0.1.0"
layer: plugin
status: implemented
generated: "2026-06-02"
---

# @fliwright/plugin-riverpod

> Riverpod state management plugin — provides StateAdapter for reading, writing, watching, and overriding Riverpod providers.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `RiverpodStateAdapter` | StateAdapter implementation for Riverpod providers | [RiverpodStateAdapter.md](./RiverpodStateAdapter.md) |

## Dependencies

- `@fliwright/core` workspace:* — StateAdapter interface

## Usage

```typescript
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';

const driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });
await driver.connect('ws://127.0.0.1:8181/ws');

// Read provider state
const value = await driver.state.read('counterProvider');

// Override provider state
await driver.state.override('counterProvider', 42);
```
