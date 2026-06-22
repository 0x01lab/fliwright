# Fliwright TDD — P0.1 (FlutterDaemonController) + P0.2 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two P0 de-risking pieces — a `flutter daemon`-driven app controller with reload + hot restart, and a spike that proves the in-process Vitest focused-rerun, single-driver ownership, and failure collection — so P0.3–P0.5 can be planned concretely.

**Architecture:** New package `@fliwright/tdd`. A `FlutterDaemonController` speaks the `flutter daemon` JSON-RPC over stdio through an injectable `DaemonTransport` (unit-tested with a fake; verified against a real daemon in a probe step). The spike proves the three risky assumptions from the spec (§6.6, §6.0, §10) with throwaway harnesses and records a verdict that gates the follow-up plan.

**Tech Stack:** TypeScript (ESM, strict, Node16, ES2022), Vitest 2.1.9 (the pinned version), `flutter daemon` JSON-RPC, pnpm workspace.

## Global Constraints

- TS: ESM, `strict`, `module: Node16`, `moduleResolution: Node16`, `target: ES2022`; include `.js` in relative imports; source in `src`, export from `src/index.ts`; `*.test.ts` under `tests/` mirroring `src`.
- Package name `@fliwright/tdd`, `version: 0.1.0`, `type: module`, `dependencies: { "@fliwright/core": "workspace:*", "@fliwright/vitest": "workspace:*", "vitest": "^2.0.0" }`; scripts `build: tsc`, `test: vitest run`, `lint: tsc --noEmit`.
- tsconfig matches `packages/fliwright-vitest/tsconfig.json` verbatim (same compilerOptions).
- Pinned Vitest is **2.1.9** (`node_modules/vitest/package.json`). Focused-rerun API verified there: `Vitest.rerunFiles(files?: string[], trigger?: string, allTestsRun?: boolean)` and `changeNamePattern(pattern, files?, trigger?)` — **no options object, no `testNamePattern` on `rerunFiles`**.
- `flutter daemon` protocol: line-delimited JSON; each line is a JSON **array** of messages; requests `{id, method, params}`, responses `{id, result|error}`, events `{event, params}`. **Verify exact field names against a real daemon in Task 4's probe step** — do not assume.
- Conventional Commits; one commit per task; `pnpm --filter @fliwright/tdd test` to run this package's tests.
- All new code is additive; `@fliwright/vitest` gains one opt-in option (Task 7); default behavior unchanged.

---

## File Structure

```
packages/fliwright-tdd/                        [NEW package]
  package.json
  tsconfig.json
  src/
    index.ts                                   re-exports public API
    types.ts                                   shared types (FailureOutcome, etc.)
    daemon/
      DaemonTransport.ts                       transport interface + DaemonMessage/AppHandle/AppStartParams types
      SubprocessDaemonTransport.ts             real impl: spawns `flutter daemon`, line protocol
      FlutterDaemonController.ts               start / startApp / reload / restart / stop / dispose
    executor/
      PersistentTestExecutor.ts                in-process vitest; rerun(file, testName) → outcome  [Task 8]
      FocusedRerunRecipe.ts                    the winning recipe from the spike (Task 6)          [Task 8]
      ResultReporter.ts                        custom vitest reporter → collected pass/fail         [Task 8]
  tests/
    daemon/
      FakeDaemonTransport.ts                   scripted transport for unit tests
      FlutterDaemonController.test.ts
    executor/
      PersistentTestExecutor.test.ts           [Task 8]
  spike/                                       throwaway harnesses (not shipped)
    probe-daemon-fields.mjs                    [Task 4 probe]
    fixture-project/                           [Tasks 6/8]
      vitest.config.ts
      .fliwright/tests/sample.test.ts
    probe-vitest-rerun.mjs                     [Task 6]
    probe-driver-ownership.mjs                 [Task 7]
    findings/
      2026-06-22-vitest-rerun-recipe.md        [Task 6 output]
      2026-06-22-driver-ownership.md           [Task 7 output]
      2026-06-22-spike-verdict.md              [Task 9 output]

packages/fliwright-vitest/src/index.ts         [MODIFY — Task 7 only] add optional { driverProvider } to createFliwrightTest
```

- `daemon/` and `executor/` are separate concerns → separate dirs.
- Spike harnesses live under `spike/`, excluded from the package build (not in `src`), kept for reproducibility.
- Task boundaries: each task ships an independently testable deliverable + a commit.

---

## Task 1: Scaffold `@fliwright/tdd` package + daemon types

**Files:**
- Create: `packages/fliwright-tdd/package.json`
- Create: `packages/fliwright-tdd/tsconfig.json`
- Create: `packages/fliwright-tdd/src/index.ts`
- Create: `packages/fliwright-tdd/src/daemon/DaemonTransport.ts`
- Test: `packages/fliwright-tdd/tests/daemon/types-smoke.test.ts`

**Interfaces:**
- Produces: `DaemonMessage`, `AppStartParams`, `AppHandle`, `DaemonTransport` (exported from `src/daemon/DaemonTransport.ts` and re-exported by `src/index.ts`).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@fliwright/tdd",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@fliwright/core": "workspace:*",
    "@fliwright/vitest": "workspace:*",
    "vitest": "^2.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`** (copy `packages/fliwright-vitest/tsconfig.json` verbatim).

- [ ] **Step 3: Write `src/daemon/DaemonTransport.ts`**

```ts
export interface DaemonMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: string | number; message: string; data?: unknown };
  event?: string;
}

export interface AppStartParams {
  projectId?: string;
  deviceId: string;
  target?: string;
  flutterArgs?: string[];
  mode?: 'run' | 'drive';
}

export interface AppHandle {
  appId: string;
  deviceId: string;
  wsUri: string;
  supportsRestart: boolean;
}

/**
 * Line transport over `flutter daemon` JSON-RPC. Unit-tested via a fake;
 * the real subprocess impl is SubprocessDaemonTransport.
 */
export interface DaemonTransport {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(handler: (message: DaemonMessage) => void): () => void;
  dispose(): Promise<void>;
}
```

- [ ] **Step 4: Write `src/index.ts`**

```ts
export type { DaemonMessage, AppStartParams, AppHandle, DaemonTransport } from './daemon/DaemonTransport.js';
```

- [ ] **Step 5: Write the failing smoke test `tests/daemon/types-smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { DaemonTransport, AppHandle, DaemonMessage } from '../../src/index.js';

describe('package scaffold', () => {
  it('exports the daemon transport types', () => {
    const t: DaemonTransport = { request: async () => ({}), onEvent: () => () => {}, dispose: async () => {} };
    const h: AppHandle = { appId: 'a', deviceId: 'd', wsUri: 'ws://x', supportsRestart: true };
    const m: DaemonMessage = { event: 'app.started', params: { appId: 'a' } };
    expect(t).toBeDefined();
    expect(h.appId).toBe('a');
    expect(m.event).toBe('app.started');
  });
});
```

- [ ] **Step 6: Install + run tests to verify they pass**

Run: `pnpm install && pnpm --filter @fliwright/tdd test`
Expected: PASS (1 test). If `pnpm install` is skipped, ensure `@fliwright/tdd` resolves via workspace.

- [ ] **Step 7: Lint**

Run: `pnpm --filter @fliwright/tdd lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-tdd
git commit -m "feat(tdd): scaffold @fliwright/tdd package with daemon transport types"
```

---

## Task 2: `FakeDaemonTransport` + `FlutterDaemonController` skeleton (handshake)

**Files:**
- Create: `packages/fliwright-tdd/tests/daemon/FakeDaemonTransport.ts`
- Create: `packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts`
- Modify: `packages/fliwright-tdd/src/index.ts` (export `FlutterDaemonController`)
- Test: `packages/fliwright-tdd/tests/daemon/FlutterDaemonController.test.ts`

**Interfaces:**
- Produces: `class FlutterDaemonController { constructor(transport: DaemonTransport); start(): Promise<void>; dispose(): Promise<void> }` plus a private `waitForEvent` helper.

- [ ] **Step 1: Write `FakeDaemonTransport.ts`** (scripted request handlers + event queue)

```ts
import type { DaemonMessage, DaemonTransport } from '../../src/daemon/DaemonTransport.js';

type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class FakeDaemonTransport implements DaemonTransport {
  private handlers = new Map<string, RequestHandler>();
  private listeners = new Set<(m: DaemonMessage) => void>();
  public requests: Array<{ method: string; params: Record<string, unknown> }> = [];

  on(method: string, handler: RequestHandler): this {
    this.handlers.set(method, handler);
    return this;
  }
  emit(message: DaemonMessage): void {
    for (const l of this.listeners) l(message);
  }
  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.requests.push({ method, params });
    const h = this.handlers.get(method);
    if (!h) throw new Error(`FakeDaemonTransport: no handler for ${method}`);
    return (await h(method, params)) as T;
  }
  onEvent(handler: (m: DaemonMessage) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  async dispose(): Promise<void> {}
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { FakeDaemonTransport } from './FakeDaemonTransport.js';
import { FlutterDaemonController } from '../../src/daemon/FlutterDaemonController.js';

describe('FlutterDaemonController.start (handshake)', () => {
  it('sends no request on start and is idempotent', async () => {
    const transport = new FakeDaemonTransport();
    const controller = new FlutterDaemonController(transport);
    await controller.start();
    await controller.start(); // idempotent
    expect(transport.requests).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @fliwright/tdd test`
Expected: FAIL — `FlutterDaemonController` is not exported / module not found.

- [ ] **Step 4: Write `src/daemon/FlutterDaemonController.ts`**

```ts
import type { DaemonMessage, DaemonTransport, AppHandle, AppStartParams } from './DaemonTransport.js';

export class FlutterDaemonController {
  private started = false;
  private readonly handles = new Map<string, AppHandle>();

  constructor(private readonly transport: DaemonTransport) {}

  async start(): Promise<void> {
    // `flutter daemon` emits daemon.connected unsolicited on stdout; no request needed.
    this.started = true;
  }

  protected async waitForEvent(
    event: string,
    predicate: (m: DaemonMessage) => boolean,
    timeoutMs: number,
  ): Promise<DaemonMessage> {
    return new Promise<DaemonMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`waitForEvent('${event}') timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const off = this.transport.onEvent((m) => {
        if (m.event === event && predicate(m)) {
          clearTimeout(timer);
          off();
          resolve(m);
        }
      });
    });
  }

  async dispose(): Promise<void> {
    this.started = false;
    await this.transport.dispose();
  }
}
```

- [ ] **Step 5: Update `src/index.ts`**

```ts
export type { DaemonMessage, AppStartParams, AppHandle, DaemonTransport } from './daemon/DaemonTransport.js';
export { FlutterDaemonController } from './daemon/FlutterDaemonController.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @fliwright/tdd test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-tdd
git commit -m "feat(tdd): FlutterDaemonController skeleton with injectable transport + fake"
```

---

## Task 3: `startApp` — `app.start` + capture `appId` / `wsUri` / restart capability

**Files:**
- Modify: `packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts`
- Test: `packages/fliwright-tdd/tests/daemon/FlutterDaemonController.test.ts`

**Interfaces:**
- Produces: `FlutterDaemonController.startApp(params: AppStartParams, opts?: { debugPortTimeoutMs?: number }): Promise<AppHandle>`.

- [ ] **Step 1: Add the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { FakeDaemonTransport } from './FakeDaemonTransport.js';
import { FlutterDaemonController } from '../../src/daemon/FlutterDaemonController.js';

describe('FlutterDaemonController.startApp', () => {
  it('calls app.start, awaits app.debugPort, and returns the wsUri', async () => {
    const transport = new FakeDaemonTransport().on('app.start', async () => ({
      appId: 'app-1',
      deviceId: 'emulator-5554',
      directory: '/proj',
    }));
    const controller = new FlutterDaemonController(transport);

    const appHandleP = controller.startApp({ deviceId: 'emulator-5554', target: 'lib/main.dart' });
    // daemon emits the debugPort event after app.start resolves
    transport.emit({ event: 'app.debugPort', params: { appId: 'app-1', wsUri: 'ws://127.0.0.1:4000/abc=/ws' } });

    const handle = await appHandleP;
    expect(transport.requests[0]).toMatchObject({ method: 'app.start', params: { deviceId: 'emulator-5554', target: 'lib/main.dart' } });
    expect(handle).toMatchObject({ appId: 'app-1', wsUri: 'ws://127.0.0.1:4000/abc=/ws', supportsRestart: true });
  });

  it('rejects when app.debugPort never arrives', async () => {
    const transport = new FakeDaemonTransport().on('app.start', async () => ({ appId: 'app-2', deviceId: 'd' }));
    const controller = new FlutterDaemonController(transport);
    await expect(controller.startApp({ deviceId: 'd' }, { debugPortTimeoutMs: 50 })).rejects.toThrow(/timed out/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @fliwright/tdd test`
Expected: FAIL — `startApp is not a function`.

- [ ] **Step 3: Implement `startApp`** (add to `FlutterDaemonController`)

```ts
  async startApp(params: AppStartParams, opts: { debugPortTimeoutMs?: number } = {}): Promise<AppHandle> {
    if (!this.started) await this.start();
    const result = await this.transport.request<{
      appId: string; deviceId?: string; directory?: string; supportsRestart?: boolean;
    }>('app.start', {
      projectId: params.projectId ?? '',
      deviceId: params.deviceId,
      target: params.target ?? 'lib/main.dart',
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.flutterArgs ? { flutterArgs: params.flutterArgs } : {}),
    });
    const appId = result.appId;
    const debugPort = await this.waitForEvent(
      'app.debugPort',
      (m) => (m.params?.appId as string | undefined) === appId,
      opts.debugPortTimeoutMs ?? 60_000,
    );
    const wsUri = debugPort.params?.wsUri as string;
    if (!wsUri) throw new Error(`app.debugPort for ${appId} carried no wsUri`);
    const supportsRestart = result.supportsRestart ?? params.mode !== 'drive';
    const handle: AppHandle = {
      appId,
      deviceId: result.deviceId ?? params.deviceId,
      wsUri,
      supportsRestart,
    };
    this.handles.set(appId, handle);
    return handle;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @fliwright/tdd test`
Expected: PASS (4 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-tdd
git commit -m "feat(tdd): startApp captures appId, wsUri, and restart capability"
```

---

## Task 4: Real-daemon probe — confirm field names, then `SubprocessDaemonTransport`

> This task verifies the exact `flutter daemon` wire format and field names against a real daemon **before** relying on them. The probe's recorded output is the source of truth; if any field name differs from Tasks 1–3, update the controller here.

**Files:**
- Create: `packages/fliwright-tdd/spike/probe-daemon-fields.mjs`
- Create: `packages/fliwright-tdd/spike/findings/2026-06-22-daemon-fields.md`
- Create: `packages/fliwright-tdd/src/daemon/SubprocessDaemonTransport.ts`
- Modify: `packages/fliwright-tdd/src/index.ts` (export `SubprocessDaemonTransport`)

**Interfaces:**
- Produces: `class SubprocessDaemonTransport implements DaemonTransport { constructor(opts: { flutterBin?: string; cwd?: string; extraArgs?: string[] }); connect(): Promise<void> }`.

- [ ] **Step 1: Write `spike/probe-daemon-fields.mjs`** (manual probe — capture real output)

```js
// Usage: node spike/probe-daemon-fields.mjs
// Starts `flutter daemon`, sends device.getDevices + app.start, logs raw stdout lines.
// Requires a booted device/emulator and a Flutter app entry at lib/main.dart.
import { spawn } from 'node:child_process';

const child = spawn('flutter', ['daemon'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    console.log('<<', line); // record these in the findings doc
    try {
      const msgs = JSON.parse(line);
      const connected = msgs.find((m) => m.event === 'daemon.connected');
      if (connected) {
        child.stdin.write(JSON.stringify([{ id: '1', method: 'device.getDevices' }]) + '\n');
      }
    } catch { /* not JSON */ }
  }
});
child.stderr.on('data', (c) => process.stderr.write(c));
setTimeout(() => { child.kill(); process.exit(0); }, 15000);
```

- [ ] **Step 2: Run the probe and record findings**

Run (with a booted device): `node packages/fliwright-tdd/spike/probe-daemon-fields.mjs`
Capture into `spike/findings/2026-06-22-daemon-fields.md`:
- Is each line a JSON **array** of messages? (expected: yes)
- `daemon.connected` params shape (`version`, `capabilities`).
- `app.start` request param names and the response field carrying `appId`.
- `app.debugPort` event param names (`appId`, `wsUri`, `baselineUri`).
- Whether any field advertises restart support.
**If any name differs from Tasks 1–3, update `AppStartParams`/`startApp` and the probe-confirmed names win.**

- [ ] **Step 3: Write the failing test for `SubprocessDaemonTransport` framing** (pure line-parse unit; no real daemon)

Create `tests/daemon/SubprocessDaemonTransport.parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

// Expose the line parser for unit testing. Export it from the module.
import { parseDaemonLines } from '../../src/daemon/SubprocessDaemonTransport.js';

describe('parseDaemonLines', () => {
  it('parses an array-wrapped event line into messages', () => {
    const line = JSON.stringify([{ event: 'daemon.connected', params: { version: '3.x' } }]);
    expect(parseDaemonLines(line)).toEqual([{ event: 'daemon.connected', params: { version: '3.x' } }]);
  });
  it('ignores non-JSON lines', () => {
    expect(parseDaemonLines('not json')).toEqual([]);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @fliwright/tdd test`
Expected: FAIL — `parseDaemonLines` not exported.

- [ ] **Step 5: Implement `src/daemon/SubprocessDaemonTransport.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { DaemonMessage, DaemonTransport } from './DaemonTransport.js';

export function parseDaemonLines(line: string): DaemonMessage[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? (parsed as DaemonMessage[]) : [parsed as DaemonMessage];
  } catch {
    return [];
  }
}

export interface SubprocessDaemonTransportOptions {
  flutterBin?: string;
  cwd?: string;
  extraArgs?: string[];
}

export class SubprocessDaemonTransport implements DaemonTransport {
  private child?: ChildProcessWithoutNullStreams;
  private buf = '';
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private readonly listeners = new Set<(m: DaemonMessage) => void>();

  constructor(private readonly opts: SubprocessDaemonTransportOptions = {}) {}

  async connect(): Promise<void> {
    this.child = spawn(this.opts.flutterBin ?? 'flutter', ['daemon', ...(this.opts.extraArgs ?? [])], {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buf += chunk;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        for (const msg of parseDaemonLines(line)) this.dispatch(msg);
      }
    });
    this.child.stderr.on('data', () => { /* swallow; surfaced via dispose errors if needed */ });
  }

  private dispatch(msg: DaemonMessage): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(Number(msg.id));
      if (p) {
        this.pending.delete(Number(msg.id));
        msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      }
      return;
    }
    if (msg.event) for (const l of this.listeners) l(msg);
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.seq++;
    const line = JSON.stringify([{ id, method, params }]) + '\n';
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.child?.stdin.write(line);
    });
  }

  onEvent(handler: (m: DaemonMessage) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async dispose(): Promise<void> {
    this.child?.kill();
    this.child = undefined;
  }
}
```

- [ ] **Step 6: Export it from `src/index.ts`**

```ts
export { SubprocessDaemonTransport, parseDaemonLines } from './daemon/SubprocessDaemonTransport.js';
```

(keep existing exports above it)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @fliwright/tdd test`
Expected: PASS (line parser + earlier tests).

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-tdd
git commit -m "feat(tdd): SubprocessDaemonTransport for flutter daemon + real-daemon field probe"
```

---

## Task 5: `reload` / `restart` (gated) / `stop`

**Files:**
- Modify: `packages/fliwright-tdd/src/daemon/FlutterDaemonController.ts`
- Test: `packages/fliwright-tdd/tests/daemon/FlutterDaemonController.test.ts`

**Interfaces:**
- Produces: `reload(appId): Promise<void>`, `restart(appId): Promise<void>` (throws if `supportsRestart` false), `stop(appId): Promise<void>`.

- [ ] **Step 1: Add failing tests**

```ts
describe('FlutterDaemonController reload/restart/stop', () => {
  async function boot() {
    const transport = new FakeDaemonTransport().on('app.start', async (_m, p) => ({ appId: 'app-1', deviceId: p.deviceId }));
    const controller = new FlutterDaemonController(transport);
    const started = controller.startApp({ deviceId: 'd' });
    transport.emit({ event: 'app.debugPort', params: { appId: 'app-1', wsUri: 'ws://x/ws' } });
    await started;
    return { transport, controller };
  }

  it('reload sends app.restart with fullRestart:false', async () => {
    const { transport, controller } = await boot();
    await controller.reload('app-1');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'app.restart', params: { appId: 'app-1', fullRestart: false } });
  });

  it('restart sends app.restart with fullRestart:true', async () => {
    const { transport, controller } = await boot();
    await controller.restart('app-1');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'app.restart', params: { appId: 'app-1', fullRestart: true } });
  });

  it('stop sends app.stop', async () => {
    const { transport, controller } = await boot();
    await controller.stop('app-1');
    expect(transport.requests.at(-1)).toMatchObject({ method: 'app.stop', params: { appId: 'app-1' } });
  });
});
```

Add a second boot helper for a non-restartable app:

```ts
  it('restart throws when supportsRestart is false', async () => {
    const transport = new FakeDaemonTransport().on('app.start', async () => ({ appId: 'app-2', deviceId: 'd', supportsRestart: false }));
    const controller = new FlutterDaemonController(transport);
    const started = controller.startApp({ deviceId: 'd' });
    transport.emit({ event: 'app.debugPort', params: { appId: 'app-2', wsUri: 'ws://x/ws' } });
    await started;
    await expect(controller.restart('app-2')).rejects.toThrow(/restart not supported/i);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @fliwright/tdd test`
Expected: FAIL — `reload`/`restart`/`stop` undefined.

- [ ] **Step 3: Implement** (add to `FlutterDaemonController`)

```ts
  private require(appId: string): AppHandle {
    const h = this.handles.get(appId);
    if (!h) throw new Error(`Unknown appId: ${appId}`);
    return h;
  }

  async reload(appId: string): Promise<void> {
    this.require(appId);
    await this.transport.request('app.restart', { appId, fullRestart: false });
  }

  async restart(appId: string): Promise<void> {
    const h = this.require(appId);
    if (!h.supportsRestart) throw new Error(`Hot restart not supported for app ${appId}`);
    await this.transport.request('app.restart', { appId, fullRestart: true });
  }

  async stop(appId: string): Promise<void> {
    this.require(appId);
    await this.transport.request('app.stop', { appId });
    this.handles.delete(appId);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @fliwright/tdd test`
Expected: PASS (all controller tests).

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-tdd
git commit -m "feat(tdd): FlutterDaemonController reload/restart(gated)/stop"
```

> **P0.1 complete.** End-to-end against a real daemon is exercised in the P0.2 spike harnesses (Tasks 6–8) which need a live app; a dedicated real-flutter smoke is folded into Plan 2's e2e task.

---

## Task 6 (SPIKE — gates P0.3+): Prove in-process Vitest 2.1.9 focused rerun

**Acceptance gate:** a recorded recipe (in `spike/findings/2026-06-22-vitest-rerun-recipe.md`) that, using the held `Vitest` instance on 2.1.9, reruns **only** a single named test in a file and lets us collect its pass/fail. If none of the three candidates works, record that and the spike falls back to the subprocess-watch plan (Task 9).

**Files:**
- Create: `packages/fliwright-tdd/spike/fixture-project/.fliwright/tests/sample.test.ts`
- Create: `packages/fliwright-tdd/spike/fixture-project/vitest.config.ts`
- Create: `packages/fliwright-tdd/spike/probe-vitest-rerun.mjs`
- Create: `packages/fliwright-tdd/spike/findings/2026-06-22-vitest-rerun-recipe.md`

- [ ] **Step 1: Create the fixture project** with two named tests

`spike/fixture-project/.fliwright/tests/sample.test.ts`:

```ts
import { describe, test as base, expect } from 'vitest';

const test = base; // plain vitest test for the spike (no fliwright fixtures yet)

describe('sample', () => {
  test('alpha passes', () => { expect(1 + 1).toBe(2); });
  test('beta fails', () => { expect(1 + 1).toBe(3); });
});
```

`spike/fixture-project/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['.fliwright/tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

- [ ] **Step 2: Write `spike/probe-vitest-rerun.mjs`** trying all three candidate recipes

```js
import { startVitest } from 'vitest/node';

const root = new URL('./fixture-project/', import.meta.url).pathname;

// A collecting reporter to observe which tests ran.
function makeCollector() {
  const ran = [];
  const reporter = {
    onTaskFinished: (task) => { ran.push({ name: task.name, mode: task.mode, result: task.result?.state }); },
    onInit: () => {},
  };
  return { reporter, ran };
}

async function tryRecipe(label, fn) {
  const { reporter, ran } = makeCollector();
  const v = await startVitest('test', [], { config: root, reporters: [reporter] });
  try {
    await fn(v);
  } catch (e) {
    console.log(`[${label}] THREW:`, e.message);
    await v.close();
    return;
  }
  // give reporters a tick
  await new Promise((r) => setTimeout(r, 100));
  console.log(`[${label}] ran:`, JSON.stringify(ran));
  await v.close();
}

await tryRecipe('A: changeNamePattern+rerunFiles', async (v) => {
  await v.changeNamePattern('alpha', ['.fliwright/tests/sample.test.ts']);
  await v.rerunFiles(['.fliwright/tests/sample.test.ts']);
});
await tryRecipe('B: configOverride testNamePattern+rerunFiles', async (v) => {
  v.configOverride = { ...(v.configOverride ?? {}), testNamePattern: 'alpha' };
  await v.rerunFiles(['.fliwright/tests/sample.test.ts']);
});
await tryRecipe('C: rerunFiles only (no name filter, control)', async (v) => {
  await v.rerunFiles(['.fliwright/tests/sample.test.ts']);
});
```

- [ ] **Step 3: Run the probe**

Run: `node packages/fliwright-tdd/spike/probe-vitest-rerun.mjs`
Expected: console shows which recipe ran **only** `alpha`. The exact `Vitest` reporter API names (`onTaskFinished` etc.) may differ — if the reporter throws, adjust to the 2.1.9 reporter interface (`onTaskFinished`/`onTestRunEnd`/collected tasks via `v.state.getTestModules()`). The goal is to observe the run set, not the exact hook.

- [ ] **Step 4: Record the winning recipe** in `spike/findings/2026-06-22-vitest-rerun-recipe.md`:
- Which candidate isolated the single test?
- The exact calls + reporter hook used.
- Note any 2.1.9 quirks (e.g., must call `changeNamePattern` before `rerunFiles`; `configOverride` mutability).
- If **none** isolated the test, write that explicitly — the spike falls back (Task 9).

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-tdd/spike
git commit -m "spike(tdd): record Vitest 2.1.9 focused-rerun recipe"
```

---

## Task 7 (SPIKE): Injectable `driverProvider` in `@fliwright/vitest` + prove connect-once

**Acceptance gate:** `createFliwrightTest(config, { driverProvider })` uses the injected driver and does **not** touch `sharedDriver`; a harness that reruns a fixture test N times shows the provider (hence `FliwrightDriver.connect`) called exactly **once**.

**Files:**
- Modify: `packages/fliwright-vitest/src/index.ts` (additive option only)
- Create: `packages/fliwright-tdd/spike/probe-driver-ownership.mjs`
- Create: `packages/fliwright-tdd/spike/findings/2026-06-22-driver-ownership.md`
- Test: `packages/fliwright-vitest/tests/create-fliwright-test.driverProvider.test.ts`

**Interfaces:**
- Produces (in `@fliwright/vitest`): `createFliwrightTest(config: FliwrightConfig, options?: { driverProvider?: () => Promise<FliwrightDriver> })`. When `options.driverProvider` is set, the `driver`/`page`/`aiRuntime` fixtures call it instead of `getSharedDriver(config)`.

- [ ] **Step 1: Write the failing unit test** in `@fliwright/vitest`

`packages/fliwright-vitest/tests/create-fliwright-test.driverProvider.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createFliwrightTest } from '../src/index.js';

// A stub driver: just enough surface that fixtures won't crash before the assertion matters.
function makeStubDriver() {
  return {
    page: {},
    sendRequest: async () => ({}),
    connect: async () => {},
    dispose: async () => {},
  } as any;
}

describe('createFliwrightTest driverProvider', () => {
  it('uses the injected provider and does not create sharedDriver', async () => {
    const provider = vi.fn(async () => makeStubDriver());
    const test = createFliwrightTest(
      { vmServiceUrl: 'ws://placeholder/ws', requireAssertions: false, mode: 'script' } as any,
      { driverProvider: provider },
    );
    // Directly invoke the driver fixture without a real VM: provider returns a stub.
    await test.extend({}).driver({}, async () => {}, async (d) => { expect(d).toBeDefined(); });
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
```

> Note: the exact fixture-invocation shape may need adapting to how `vitestTest.extend` fixtures are driven outside a `test()` call. If direct fixture invocation is awkward, instead assert indirectly: spy on `getSharedDriver` is **not** called when a provider is set, via a small integration using a real `test()` that the provider stubs. The acceptance is "provider called, sharedDriver not created."

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @fliwright/vitest test`
Expected: FAIL — `createFliwrightTest` takes one argument; second arg ignored.

- [ ] **Step 3: Modify `packages/fliwright-vitest/src/index.ts`**

Change the signature and the three fixture `getSharedDriver(config)` sites. Find `export function createFliwrightTest(config: FliwrightConfig)` and replace with:

```ts
export interface CreateFliwrightTestOptions {
  /** When set, fixtures use this driver instead of lazily creating sharedDriver. */
  driverProvider?: () => Promise<FliwrightDriver>;
}

export function createFliwrightTest(config: FliwrightConfig, options?: CreateFliwrightTestOptions) {
  const resolveDriver = options?.driverProvider
    ? () => options.driverProvider!()
    : () => getSharedDriver(config);
  const fliwrightTest = vitestTest.extend<FliwrightFixtures>({
```

Then replace the three occurrences of `const driver = await getSharedDriver(config);` (inside `driver`, `page`, `aiRuntime` fixtures) with:

```ts
const driver = await resolveDriver();
```

- [ ] **Step 4: Run the vitest package tests to verify pass + no regression**

Run: `pnpm --filter @fliwright/vitest build && pnpm --filter @fliwright/vitest test`
Expected: PASS (new test + existing tests; default path unchanged).

- [ ] **Step 5: Write the ownership harness** `spike/probe-driver-ownership.mjs`

```js
import { startVitest } from 'vitest/node';
import { createFliwrightTest } from '@fliwright/vitest';
import { FliwrightDriver } from '@fliwright/core';

const root = new URL('./fixture-project/', import.meta.url).pathname;

let connectCalls = 0;
// One driver, created up front; provider returns the same instance every time.
const driver = new FliwrightDriver();
driver.connect = ((orig) => async function () { connectCalls++; return orig.call(this, ...arguments); })(driver.connect);
await driver.connect('ws://placeholder/ws'); // pre-connect; provider will return this singleton

const test = createFliwrightTest(
  { vmServiceUrl: 'ws://placeholder/ws', requireAssertions: false, mode: 'script' },
  { driverProvider: async () => driver },
);

const v = await startVitest('test', [], {
  config: root,
  pool: 'forks', poolOptions: { forks: { singleFork: true } },
});

for (let i = 0; i < 3; i++) {
  await v.changeNamePattern('alpha', ['.fliwright/tests/sample.test.ts']);
  await v.rerunFiles(['.fliwright/tests/sample.test.ts']);
  await new Promise((r) => setTimeout(r, 100));
}
console.log('connectCalls (expected 1):', connectCalls);
await v.close();
```

> This harness uses the recipe from Task 6. If the fixture test needs a real VM to pass, that's fine — the spike only asserts `connectCalls`, not test pass/fail. The placeholder VM will make the test error, but `connect` is counted at provider/driver creation, which is the invariant under test. Adjust the assertion target if `connect` isn't the right counter (e.g., count provider invocations instead).

- [ ] **Step 6: Run the harness and record findings**

Run: `node packages/fliwright-tdd/spike/probe-driver-ownership.mjs`
Record `connectCalls === 1` (or provider-invocation count === 1 across 3 reruns) in `spike/findings/2026-06-22-driver-ownership.md`.

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-vitest packages/fliwright-tdd/spike
git commit -m "feat(vitest): opt-in driverProvider injection (TDD single-driver ownership) + spike harness"
```

---

## Task 8 (SPIKE): `PersistentTestExecutor` skeleton — recipe + provider + failure collection

**Acceptance gate:** `PersistentTestExecutor.rerun(file, testName)` returns `{ status: 'red'|'green', failure?: FailureContext }` for a fixture test, reusing the Task 6 recipe and Task 7 provider.

**Files:**
- Create: `packages/fliwright-tdd/src/executor/ResultReporter.ts`
- Create: `packages/fliwright-tdd/src/executor/FocusedRerunRecipe.ts`
- Create: `packages/fliwright-tdd/src/executor/PersistentTestExecutor.ts`
- Modify: `packages/fliwright-tdd/src/index.ts` (exports)
- Test: `packages/fliwright-tdd/tests/executor/PersistentTestExecutor.test.ts`

**Interfaces:**
- Consumes: Task 6 recipe (in `FocusedRerunRecipe.ts`), Task 7 `driverProvider`.
- Produces: `class PersistentTestExecutor { boot(opts): Promise<void>; rerun(file, testName?): Promise<TestRunOutcome>; dispose(): Promise<void> }`; `TestRunOutcome { status: 'red'|'green'; testName?: string; failure?: FailureContext }`.

- [ ] **Step 1: Write `FocusedRerunRecipe.ts`** encoding the Task 6 winner

```ts
import type { Vitest } from 'vitest/node';

/**
 * Encodes the spike-confirmed Vitest 2.1.9 focused-rerun recipe
 * (see spike/findings/2026-06-22-vitest-rerun-recipe.md).
 * Adjust the bodies if Task 6 picked a different candidate.
 */
export async function focusAndRerun(v: Vitest, file: string, testName?: string): Promise<void> {
  if (testName) await v.changeNamePattern(testName, [file]);
  else await v.changeFilenamePattern(file);
  await v.rerunFiles([file]);
}
```

- [ ] **Step 2: Write `ResultReporter.ts`** (collects pass/fail from the held server)

```ts
import type { Vitest } from 'vitest/node';

export interface CollectedResult { testName: string; status: 'red' | 'green'; message?: string; }

export async function collectResults(v: Vitest): Promise<CollectedResult[]> {
  const out: CollectedResult[] = [];
  for (const file of v.state.getFiles()) {
    for (const task of file.tasks) {
      const state = task.result?.state;
      if (state === 'pass' || state === 'fail') {
        out.push({
          testName: task.name,
          status: state === 'pass' ? 'green' : 'red',
          message: Array.isArray(task.result?.errors) ? task.result!.errors.map((e) => e?.message).join('\n') : undefined,
        });
      }
    }
  }
  return out;
}
```

> `v.state.getFiles()` / `task.result.errors` are the 2.1.9 server-state API; if Task 6 found a different access path (e.g., a reporter), record it in the recipe doc and use that here instead.

- [ ] **Step 3: Write the failing test**

`tests/executor/PersistentTestExecutor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PersistentTestExecutor } from '../../src/executor/PersistentTestExecutor.js';

describe('PersistentTestExecutor.rerun', () => {
  it('reports red for a failing fixture test and green for a passing one', async () => {
    const executor = new PersistentTestExecutor();
    await executor.boot({
      configRoot: new URL('../spike/fixture-project/', import.meta.url).pathname,
      driverProvider: async () => ({ sendRequest: async () => ({}), page: {}, connect: async () => {}, dispose: async () => {} } as any),
    });
    const failing = await executor.rerun('.fliwright/tests/sample.test.ts', 'beta fails');
    expect(failing.status).toBe('red');
    const passing = await executor.rerun('.fliwright/tests/sample.test.ts', 'alpha passes');
    expect(passing.status).toBe('green');
    await executor.dispose();
  }, 30_000);
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter @fliwright/tdd test`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `PersistentTestExecutor.ts`**

```ts
import { startVitest } from 'vitest/node';
import type { Vitest } from 'vitest/node';
import { focusAndRerun } from './FocusedRerunRecipe.js';
import { collectResults, type CollectedResult } from './ResultReporter.js';

export interface TestRunOutcome {
  status: 'red' | 'green';
  testName?: string;
  failure?: { message?: string };
}

export interface BootOptions {
  configRoot: string;
  driverProvider: () => Promise<unknown>;
}

export class PersistentTestExecutor {
  private vitest?: Vitest;

  async boot(opts: BootOptions): Promise<void> {
    // The fixture project's vitest.config.ts is built with createFliwrightTest + the provider via
    // a tiny entry; for the spike we rely on the harness wiring the provider. See recipe doc.
    this.vitest = await startVitest('test', [], {
      config: opts.configRoot,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    });
  }

  async rerun(file: string, testName?: string): Promise<TestRunOutcome> {
    if (!this.vitest) throw new Error('PersistentTestExecutor not booted');
    await focusAndRerun(this.vitest, file, testName);
    const results: CollectedResult[] = await collectResults(this.vitest);
    const match = testName ? results.find((r) => r.testName === testName) : results[0];
    const picked = match ?? results[0];
    return {
      status: picked?.status ?? 'red',
      testName: picked?.testName,
      failure: picked?.status === 'red' ? { message: picked?.message } : undefined,
    };
  }

  async dispose(): Promise<void> {
    await this.vitest?.close();
    this.vitest = undefined;
  }
}
```

- [ ] **Step 6: Export from `src/index.ts`**

```ts
export { PersistentTestExecutor } from './executor/PersistentTestExecutor.js';
export type { TestRunOutcome, BootOptions } from './executor/PersistentTestExecutor.js';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @fliwright/tdd test`
Expected: PASS. If the fixture's fliwright wiring needs the provider passed into `createFliwrightTest` (Task 7), add a dedicated `spike/fixture-project/vitest.tdd.config.ts` that constructs `createFliwrightTest(config, { driverProvider })` and point `boot` at it; record the exact wiring in the recipe doc.

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-tdd
git commit -m "feat(tdd): PersistentTestExecutor skeleton (focused rerun + single driver + result collection)"
```

---

## Task 9: Spike verdict + decision gate

**Files:**
- Create: `packages/fliwright-tdd/spike/findings/2026-06-22-spike-verdict.md`

- [ ] **Step 1: Write the verdict** answering the three gates:

```markdown
# P0.2 Spike Verdict — 2026-06-22

1. Focused rerun on Vitest 2.1.9: [PASS/FAIL] — recipe = <from Task 6 doc>.
2. Single-driver ownership (connect-once): [PASS/FAIL] — see Task 7 doc.
3. Failure-result collection: [PASS/FAIL] — see Task 8.

## Decision
- All PASS → P0.3–P0.5 unblock. Write Plan 2 (BaselineManager, TddRuntime, MCP tools, VS Code/CLI).
- Any FAIL → adopt fallback: controlled `vitest watch` subprocess for execution.
  Consequences (document explicitly in the spec): reruns process-bound (no sub-second executor rerun);
  baseline-reset driver + fixture sharedDriver = two VM connections. Update spec §6.0/§6.6/§10 accordingly.
```

- [ ] **Step 2: Commit**

```bash
git add packages/fliwright-tdd/spike/findings/2026-06-22-spike-verdict.md
git commit -m "docs(tdd): P0.2 spike verdict and downstream decision"
```

> **End of plan.** Plan 2 (P0.3–P0.5) is written from this verdict.

---

## Self-Review

**1. Spec coverage (P0.1 + P0.2 only, by design):**
- §6.3 daemon reload/restart + appId/supportsRestart → Tasks 3, 4, 5. ✓
- §6.0 single-driver ownership → Task 7. ✓
- §6.6 Vitest 2.1.9 focused rerun + failure collection → Tasks 6, 8. ✓
- §10 P0.2 spike gating P0.3–P0.5 → Task 9 verdict. ✓
- P0.3 (BaselineManager), P0.4 (TddRuntime + MCP), P0.5 (VS Code/CLI) → **deliberately deferred to Plan 2**, per spec §10 (blocked on the spike). Not a gap — documented at top of this plan.

**2. Placeholder scan:** Tasks reference exact files, real code, exact commands. Spike tasks (6, 7, 8) include "adjust if the 2.1.9 API differs" notes — these are explicit verification gates, not placeholders; the acceptance criteria are concrete. No "TBD"/"implement later".

**3. Type consistency:** `AppHandle`, `DaemonTransport`, `DaemonMessage`, `AppStartParams` defined Task 1, used Tasks 2–5 unchanged. `FlutterDaemonController` method names (`start`, `startApp`, `reload`, `restart`, `stop`, `dispose`) consistent across tasks. `driverProvider` option name matches between Task 7 (`createFliwrightTest`) and Task 8 (`BootOptions`). `TestRunOutcome.status: 'red'|'green'` consistent. `parseDaemonLines`/`SubprocessDaemonTransport` exported Task 4.

No issues to fix.
