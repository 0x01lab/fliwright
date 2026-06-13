# Manual Driver Lifecycle

Reach for a raw `FliwrightDriver` only when the `@fliwright/vitest` fixture can't express what you
need: **custom plugins**, **raw VM Service extensions** (`ext.fliwright.extractForm`,
`ext.fliwright.snapshot`), **older-bridge compatibility**, or deliberately low-level coordinate
tests. For everything else, use the fixture.

## Basic lifecycle

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FliwrightDriver } from '@fliwright/core';

let driver: FliwrightDriver;

describe('registration flow', () => {
  beforeAll(async () => {
    driver = new FliwrightDriver();
    await driver.connect(process.env.FLIWRIGHT_VM_URL!);
  });

  afterAll(async () => {
    await driver?.dispose();
  });

  it('does something', async () => {
    await driver.page.getByText('Submit').click();
  });
});
```

**Always** call `await driver.dispose()` in `afterAll` to close the WebSocket.

## URL conversion

`flutter run` sometimes prints an **HTTP** VM Service URL. `connect()` needs a **WebSocket** URL
ending in `/ws`. The fixture converts automatically; raw-driver scripts must convert themselves:

```typescript
function toWsUrl(url: string): string {
  const converted = url.replace('http://', 'ws://').replace('https://', 'wss://');
  return converted.endsWith('/ws') ? converted : converted.replace(/\/?$/, '/ws');
}

await driver.connect(toWsUrl(process.env.FLIWRIGHT_VM_SERVICE_URL!));
```

## Conditional skip

Skip a whole suite cleanly when no URL is present:

```typescript
const vmServiceUrl = process.env.EXIO_VM_SERVICE_URL ?? process.env.FLIWRIGHT_VM_SERVICE_URL;

describe.skipIf(!vmServiceUrl)('Exio app live E2E', () => {
  beforeAll(async () => { /* connect */ });
  // …
});
```

## `FliwrightDriver` public surface

| Member | Signature | Purpose |
| --- | --- | --- |
| constructor | `new FliwrightDriver(options?: DriverOptions)` | `options.plugins` registers plugins at construction |
| `connect` | `connect(vmServiceUrl: string): Promise<void>` | connect to the VM Service |
| `dispose` | `dispose(): Promise<void>` | close the connection |
| `page` | `get page(): Page` | lazy `Page` (selectors/actions/nav/screenshots/forms) |
| `mock` | `get mock(): MockManager` | lazy `MockManager` (see [mocks.md](./mocks.md)) |
| `healing` | `get healing(): SelfHealingEngine` | lazy healing engine |
| `recorder` | `get recorder(): RecorderController` | lazy recorder for code-gen |
| `state` | `get state(): StateAdapter` | lazy state adapter (Riverpod, when plugin configured) |
| `sdkVersion` | `get sdkVersion(): string \| null` | resolved Dart SDK version |
| `sendRequest` | `sendRequest(method, params?): Promise<unknown>` | raw JSON-RPC to any extension |
| `reloadSources` | `reloadSources(): Promise<unknown>` | trigger a Dart hot reload |
| `listenToDiagnostics` | `listenToDiagnostics(streamIds?): Promise<void>` | subscribe to Logging/Stdout/Stderr/Isolate |
| `getDiagnostics` | `getDiagnostics(options?): VMServiceEvent[]` | read captured diagnostics |
| `clearDiagnostics` | `clearDiagnostics(): void` | reset the diagnostics buffer |
| registry getters | `getStateAdapter(name)`, `getMockAdapter(name)`, `getFinderStrategy(name)`, `getHealingStrategy(name)` | plugin lookups |
| lifecycle hooks | `notifyTestStart(name)`, `notifyTestEnd(name, result)` | plugin lifecycle |

## Raw extensions

Call any VM Service extension directly with `sendRequest`. This is how you reach features not yet
wrapped by `Page`/`Locator`, and how you support older bridges:

```typescript
// legacy form extraction (older bridge)
const { fields = [] } = await driver.sendRequest('ext.fliwright.extractForm') as { fields?: FormFieldMeta[] };

// legacy flat snapshot
const { widgets = [] } = await driver.sendRequest('ext.fliwright.snapshot') as { widgets?: LegacyWidget[] };

// type into a field by its extracted selector
await driver.sendRequest('ext.fliwright.type', {
  selector: field.selector,
  text: 'alice@example.com',
  replaceAll: 'true',
});

// make an HTTP request through the app's HttpClient to exercise the mock proxy
await driver.sendRequest('ext.fliwright.mock.testRequest',
  { url: 'http://test.local/api/ping', method: 'GET' });
```

`sendRequest` returns the raw extension response; `success`/`error` conventions vary per extension,
so check the shape:

```typescript
const result = await driver.sendRequest('ext.fliwright.type', { /* … */ }) as { success?: boolean; error?: string };
if (result.success === false || result.error) throw new Error(result.error);
```

## State / Riverpod

When the `fliwright-plugin-riverpod` adapter is registered (or the app uses the Riverpod bridge),
`driver.state` exposes provider reads/writes:

```typescript
const adapter = driver.getStateAdapter('riverpod'); // or driver.state
await adapter.read('authProvider');
await adapter.write('authProvider', { user: { id: 1 } });
await adapter.listProviders();
```

Use this to set up state directly (logged-in, pre-populated) instead of driving the UI through a
login flow on every test. See the `@fliwright/plugin-riverpod` docs for the full operation set.

## Custom plugins

Pass plugins at construction; they register state adapters, mock adapters, finder strategies, or
healing strategies:

```typescript
import { FliwrightDriver } from '@fliwright/core';
import { riverpodPlugin } from '@fliwright/plugin-riverpod';

driver = new FliwrightDriver({ plugins: [riverpodPlugin()] });
await driver.connect(toWsUrl(process.env.FLIWRIGHT_VM_URL!));
```

## Tracing

When `FLIWRIGHT_TRACE` is set (`full` or `on-failure`) and `FLIWRIGHT_TRACE_DIR` is set, the fixture
shadows `driver.sendRequest` to record per-action traces (`TraceCollector` / `TraceStore`) keyed by
a per-process `runId`. This is only wired through the fixture, not raw-driver scripts — replicate
the `sendRequest` shadowing yourself if you need it in a raw driver.

## When the fixture is the right choice (reality check)

Use the fixture (`@fliwright/vitest`) when you want any of these for free:

- shared driver + auto-connect,
- failure context (screenshot + tree + diagnostics + source + healing),
- auto-waiting `expect()` with healing,
- trace collection.

Drop to raw `FliwrightDriver` only when none of those matter and you need extension-level control.
