---
module: "vm-discovery"
package: "@fliwright/cli"
source: "src/vm-discovery.ts"
generated: "2026-06-02"
---

# `vm-discovery`

> Resolves a Flutter VM Service WebSocket URL from CLI flag, environment variable, config, or a port scan against the well-known Flutter dev ports.

## Overview

`resolveVmUrl` walks a precedence chain (CLI flag → `FLIWRIGHT_VM_URL` env var → config-supplied URL → port scan) and returns the first non-null result. The port scanner probes `http://127.0.0.1:<port>/json/version` for three canonical Flutter VM Service ports and converts a hit to `ws://127.0.0.1:<port>/ws`.

## Signature

```typescript
export interface ResolveOptions {
  cliFlag?: string;
  configUrl?: string;
}

export async function resolveVmUrl(options?: ResolveOptions): Promise<string | null>;

export async function discoverVmServiceUrl(): Promise<string | null>;
```

## Constants

```typescript
const SCAN_PORTS = [8181, 9189, 54321];
```

The three ports Flutter most commonly publishes the VM Service on (default `flutter run`, iOS simulator, and a frequently used custom port).

## Public Methods

### `resolveVmUrl(options?): Promise<string | null>`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `options.cliFlag` | `string` | No | Value of `--vm-url` from the CLI. Highest priority. |
| `options.configUrl` | `string` | No | Value from `fliwright.config.ts` `vmServiceUrl` field. |

**Returns:** `Promise<string | null>` — first non-null value from the chain, or `null` if all sources are empty and the port scan finds nothing.

**Precedence:**

1. `options.cliFlag`
2. `process.env.FLIWRIGHT_VM_URL`
3. `options.configUrl`
4. `discoverVmServiceUrl()` (port scan)

**Example:**

```typescript
import { resolveVmUrl } from '@fliwright/cli';

const url = await resolveVmUrl({ cliFlag: process.argv['vm-url'] });
if (!url) throw new Error('No Flutter VM found');
```

---

### `discoverVmServiceUrl(): Promise<string | null>`

Iterates `SCAN_PORTS`. For each port, issues `fetch('http://127.0.0.1:<port>/json/version')` with a 1-second `AbortSignal.timeout`. On a `res.ok` response, returns `ws://127.0.0.1:<port>/ws` immediately. Network errors and non-2xx responses are swallowed and the next port is tried.

**Returns:** `Promise<string | null>` — discovered URL or `null` if no port responds.

**Example:**

```typescript
import { discoverVmServiceUrl } from '@fliwright/cli';

const url = await discoverVmServiceUrl();
console.log(url ?? 'No Flutter app detected on localhost');
```

## Related

- **Depends on:** Node `fetch` (Node 18+)
- **Used by:** [run command](./run.md), [record command](./record.md), [doctor command](./doctor.md)
- **Source:** `packages/fliwright-cli/src/vm-discovery.ts`
