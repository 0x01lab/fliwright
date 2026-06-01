# Mock Rule Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime switching between named mock rules (e.g., "success", "empty", "server_error") per endpoint, driven by file-based configs in `.fliwright/mocks/`.

**Architecture:** TS-side MockRuleStore parses `.fliwright/mocks/` JSON files into an in-memory rule registry. Switching a rule calls the existing `MockManager.route()` to push the chosen response to the Flutter mock server. Dart side has zero changes.

**Tech Stack:** TypeScript, Vitest, Zod (MCP), Node.js `fs/promises` for file I/O

---

### Task 1: Add type definitions

**Files:**
- Modify: `packages/fliwright-core/src/types.ts` (append after line 228)

- [ ] **Step 1: Add MockRule, MockEndpointConfig, MockIndex, MockRuleEntry types to types.ts**

Append the following after line 228 (end of file):

```typescript
/** A named mock rule definition within an endpoint config file. */
export interface MockRule {
  name: string;
  status: number;
  delay?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Parsed structure of a .fliwright/mocks/api/*.json endpoint config file. */
export interface MockEndpointConfig {
  version: number;
  name: string;
  description?: string;
  method: string;
  endpoint: string;
  rules: MockRule[];
}

/** Parsed structure of a .fliwright/mocks/mock-index.json file. */
export interface MockIndex {
  version: number;
  defaultRule: string;
  files: string[];
}

/** In-memory entry tracking one endpoint's rules and active selection. */
export interface MockRuleEntry {
  endpoint: string;
  method: string;
  rules: Map<string, MockRule>;
  activeRule: string;
}
```

- [ ] **Step 2: Export the new types from index.ts**

In `packages/fliwright-core/src/index.ts`, add the new types to the type export block (after line 27, inside the existing `export type { ... } from './types.js'`):

```typescript
  MockRule,
  MockEndpointConfig,
  MockIndex,
  MockRuleEntry,
```

- [ ] **Step 3: Run type check to verify**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-core/src/types.ts packages/fliwright-core/src/index.ts
git commit -m "feat(core): add MockRule, MockEndpointConfig, MockIndex, MockRuleEntry types"
```

---

### Task 2: Create MockRuleStore with tests

**Files:**
- Create: `packages/fliwright-core/src/MockRuleStore.ts`
- Create: `packages/fliwright-core/tests/MockRuleStore.test.ts`

- [ ] **Step 1: Write the failing tests for MockRuleStore**

Create `packages/fliwright-core/tests/MockRuleStore.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockRuleStore } from '../src/MockRuleStore.js';
import type { MockRule, MockEndpointConfig, MockIndex } from '../src/types.js';
import { readFile, readdir } from 'node:fs/promises';

// We'll mock fs/promises at the module level
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);

describe('MockRuleStore', () => {
  let store: MockRuleStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new MockRuleStore();
  });

  describe('loadFromDirectory()', () => {
    it('loads mock-index.json and all endpoint files', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/get-token.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Get Token List',
        method: 'GET',
        endpoint: '/v1/public/token',
        rules: [
          { name: 'success', status: 200, body: { data: [] } },
          { name: 'empty', status: 200, body: { data: [] } },
          { name: 'server_error', status: 500, body: { error: 'fail' } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('get-token.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const endpoints = store.listEndpoints();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].endpoint).toBe('/v1/public/token');
      expect(endpoints[0].method).toBe('GET');
      expect(endpoints[0].rules).toEqual(['success', 'empty', 'server_error']);
      expect(endpoints[0].activeRule).toBe('success');
    });

    it('silently skips when mock-index.json does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()).toEqual([]);
    });

    it('skips individual files that fail to parse', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/good.json', 'api/bad.json'],
      };
      const goodEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Good',
        method: 'GET',
        endpoint: '/api/good',
        rules: [{ name: 'success', status: 200, body: {} }],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('good.json')) return JSON.stringify(goodEndpoint);
        if (p.endsWith('bad.json')) return 'not valid json{{{';
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const endpoints = store.listEndpoints();
      expect(endpoints).toHaveLength(1);
      expect(endpoints[0].endpoint).toBe('/api/good');
    });

    it('sets activeRule to defaultRule from index', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'empty',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'POST',
        endpoint: '/api/test',
        rules: [
          { name: 'success', status: 200, body: {} },
          { name: 'empty', status: 200, body: {} },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(store.listEndpoints()[0].activeRule).toBe('empty');
    });
  });

  describe('listEndpoints()', () => {
    it('returns empty array when no rules loaded', () => {
      expect(store.listEndpoints()).toEqual([]);
    });
  });

  describe('switchRule()', () => {
    it('switches active rule for an endpoint', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'GET',
        endpoint: '/api/test',
        rules: [
          { name: 'success', status: 200, body: { ok: true } },
          { name: 'error', status: 500, body: { fail: true } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const response = store.switchRule('/api/test', 'error');

      expect(response).toEqual({ status: 500, body: { fail: true } });
      expect(store.listEndpoints()[0].activeRule).toBe('error');
    });

    it('throws if endpoint not found', () => {
      expect(() => store.switchRule('/api/nonexistent', 'success')).toThrow(
        /endpoint.*not found/i,
      );
    });

    it('throws if ruleName not found and lists available rules', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'GET',
        endpoint: '/api/test',
        rules: [{ name: 'success', status: 200, body: {} }],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      expect(() => store.switchRule('/api/test', 'nonexistent')).toThrow(
        /rule "nonexistent" not found.*available: success/i,
      );
    });
  });

  describe('getActiveResponse()', () => {
    it('returns the active rule response for an endpoint', async () => {
      const mockIndex: MockIndex = {
        version: 1,
        defaultRule: 'success',
        files: ['api/test.json'],
      };
      const mockEndpoint: MockEndpointConfig = {
        version: 1,
        name: 'Test',
        method: 'GET',
        endpoint: '/api/test',
        rules: [
          { name: 'success', status: 200, delay: 100, headers: { 'Content-Type': 'application/json' }, body: { ok: true } },
        ],
      };

      mockReadFile.mockImplementation(async (path: string) => {
        const p = path.toString();
        if (p.endsWith('mock-index.json')) return JSON.stringify(mockIndex);
        if (p.endsWith('test.json')) return JSON.stringify(mockEndpoint);
        throw new Error(`Unexpected read: ${p}`);
      });

      await store.loadFromDirectory('/project/.fliwright/mocks');

      const response = store.getActiveResponse('/api/test');
      expect(response).toEqual({
        status: 200,
        delay: 100,
        headers: { 'Content-Type': 'application/json' },
        body: { ok: true },
      });
    });

    it('returns null for unknown endpoint', () => {
      expect(store.getActiveResponse('/api/nope')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run test -- --reporter=verbose tests/MockRuleStore.test.ts`
Expected: FAIL — `MockRuleStore` module not found

- [ ] **Step 3: Implement MockRuleStore**

Create `packages/fliwright-core/src/MockRuleStore.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MockRule, MockRuleEntry, MockEndpointConfig, MockIndex, MockRouteResponse } from './types.js';

export class MockRuleStore {
  private entries = new Map<string, MockRuleEntry>();

  /**
   * Load mock configurations from a directory.
   * Reads mock-index.json for the default rule and file list,
   * then parses each endpoint config file.
   * Silently skips if the directory or index file doesn't exist.
   */
  async loadFromDirectory(mockDir: string): Promise<void> {
    const indexPath = join(mockDir, 'mock-index.json');

    let indexJson: string;
    try {
      indexJson = await readFile(indexPath, 'utf-8');
    } catch {
      // Index file missing — skip silently
      return;
    }

    const index = JSON.parse(indexJson) as MockIndex;

    for (const file of index.files) {
      const filePath = join(mockDir, file);
      try {
        const content = await readFile(filePath, 'utf-8');
        const config = JSON.parse(content) as MockEndpointConfig;
        this.registerEndpoint(config, index.defaultRule);
      } catch (e) {
        // Skip files that fail to parse — log a warning
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[MockRuleStore] Skipping ${file}: ${message}`);
      }
    }
  }

  /**
   * Register a single endpoint config with a default active rule.
   */
  private registerEndpoint(config: MockEndpointConfig, defaultRule: string): void {
    const rules = new Map<string, MockRule>();
    for (const rule of config.rules) {
      rules.set(rule.name, rule);
    }

    const activeRule = rules.has(defaultRule) ? defaultRule : config.rules[0]?.name ?? '';

    this.entries.set(config.endpoint, {
      endpoint: config.endpoint,
      method: config.method,
      rules,
      activeRule,
    });
  }

  /**
   * List all registered endpoints with their rules and active selection.
   */
  listEndpoints(): Array<{
    endpoint: string;
    method: string;
    rules: string[];
    activeRule: string;
  }> {
    return Array.from(this.entries.values()).map((entry) => ({
      endpoint: entry.endpoint,
      method: entry.method,
      rules: Array.from(entry.rules.keys()),
      activeRule: entry.activeRule,
    }));
  }

  /**
   * Get the active rule's response for an endpoint.
   * Returns null if the endpoint is not registered.
   */
  getActiveResponse(endpoint: string): MockRouteResponse | null {
    const entry = this.entries.get(endpoint);
    if (!entry) return null;

    const rule = entry.rules.get(entry.activeRule);
    if (!rule) return null;

    const response: MockRouteResponse = {};
    if (rule.status !== undefined) response.status = rule.status;
    if (rule.headers !== undefined) response.headers = rule.headers;
    if (rule.body !== undefined) response.body = rule.body;
    if (rule.delay !== undefined) response.delay = rule.delay;

    return response;
  }

  /**
   * Switch the active rule for an endpoint.
   * Returns the new active rule's response, or throws if endpoint/rule not found.
   */
  switchRule(endpoint: string, ruleName: string): MockRouteResponse | null {
    const entry = this.entries.get(endpoint);
    if (!entry) {
      const available = Array.from(this.entries.keys());
      throw new Error(
        `Endpoint "${endpoint}" not found. Registered endpoints: ${available.join(', ') || '(none)'}`,
      );
    }

    const rule = entry.rules.get(ruleName);
    if (!rule) {
      const available = Array.from(entry.rules.keys());
      throw new Error(
        `Rule "${ruleName}" not found for endpoint "${endpoint}". Available rules: ${available.join(', ')}`,
      );
    }

    entry.activeRule = ruleName;

    const response: MockRouteResponse = {};
    if (rule.status !== undefined) response.status = rule.status;
    if (rule.headers !== undefined) response.headers = rule.headers;
    if (rule.body !== undefined) response.body = rule.body;
    if (rule.delay !== undefined) response.delay = rule.delay;

    return response;
  }

  /**
   * Check whether any rules have been loaded.
   */
  get isLoaded(): boolean {
    return this.entries.size > 0;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run test -- --reporter=verbose tests/MockRuleStore.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run type check**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run lint`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/src/MockRuleStore.ts packages/fliwright-core/tests/MockRuleStore.test.ts
git commit -m "feat(core): add MockRuleStore with parsing, switching, and unit tests"
```

---

### Task 3: Extend MockManager with rule switching API

**Files:**
- Modify: `packages/fliwright-core/src/MockManager.ts`
- Modify: `packages/fliwright-core/tests/MockManager.test.ts`
- Modify: `packages/fliwright-core/src/index.ts` (export MockRuleStore)

- [ ] **Step 1: Write the failing tests for MockManager rule methods**

Append to `packages/fliwright-core/tests/MockManager.test.ts` (after the last `it` block inside the `describe('MockManager', ...)`):

```typescript
  it('loadRules() loads rules and applies them via route()', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_1' },
    });
    const mock = new MockManager(sendRequest);

    // Use the real MockRuleStore with a mock directory — we test the integration
    // by spying on the store methods
    const { MockRuleStore } = await import('../src/MockRuleStore.js');
    const store = new MockRuleStore();
    vi.spyOn(store, 'loadFromDirectory').mockResolvedValue(undefined);
    vi.spyOn(store, 'listEndpoints').mockReturnValue([
      { endpoint: '/api/test', method: 'GET', rules: ['success'], activeRule: 'success' },
    ]);
    vi.spyOn(store, 'getActiveResponse').mockReturnValue({ status: 200, body: { ok: true } });

    // Inject store into manager
    mock['_ruleStore'] = store;

    await mock.loadRules('/mocks');

    expect(store.loadFromDirectory).toHaveBeenCalledWith('/mocks');
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.mock.addRoute', {
      route: expect.any(String),
    });
    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.path).toBe('/api/test');
    expect(parsed.method).toBe('GET');
    expect(parsed.response.status).toBe(200);
    expect(parsed.response.body).toEqual({ ok: true });
  });

  it('listRules() returns endpoints from ruleStore', async () => {
    const sendRequest = createMockSendRequest({});
    const mock = new MockManager(sendRequest);

    const { MockRuleStore } = await import('../src/MockRuleStore.js');
    const store = new MockRuleStore();
    vi.spyOn(store, 'listEndpoints').mockReturnValue([
      { endpoint: '/api/a', method: 'GET', rules: ['success', 'error'], activeRule: 'success' },
      { endpoint: '/api/b', method: 'POST', rules: ['ok'], activeRule: 'ok' },
    ]);

    mock['_ruleStore'] = store;

    const rules = mock.listRules();
    expect(rules).toHaveLength(2);
    expect(rules[0].endpoint).toBe('/api/a');
    expect(rules[0].rules).toEqual(['success', 'error']);
    expect(rules[1].activeRule).toBe('ok');
  });

  it('switchRule() switches rule and applies via route()', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.mock.addRoute': { success: true, id: 'route_1' },
    });
    const mock = new MockManager(sendRequest);

    const { MockRuleStore } = await import('../src/MockRuleStore.js');
    const store = new MockRuleStore();
    vi.spyOn(store, 'switchRule').mockReturnValue({ status: 500, body: { error: 'fail' } });

    mock['_ruleStore'] = store;

    await mock.switchRule('/api/test', 'error');

    expect(store.switchRule).toHaveBeenCalledWith('/api/test', 'error');
    const call = sendRequest.mock.calls[0][1] as { route: string };
    const parsed = JSON.parse(call.route);
    expect(parsed.path).toBe('/api/test');
    expect(parsed.response.status).toBe(500);
    expect(parsed.response.body).toEqual({ error: 'fail' });
  });

  it('listRules() returns empty array when no rules loaded', () => {
    const sendRequest = createMockSendRequest({});
    const mock = new MockManager(sendRequest);

    const rules = mock.listRules();
    expect(rules).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run test -- --reporter=verbose tests/MockManager.test.ts`
Expected: FAIL — `loadRules`, `listRules`, `switchRule` not defined on MockManager

- [ ] **Step 3: Implement the new methods on MockManager**

Replace the full content of `packages/fliwright-core/src/MockManager.ts` with:

```typescript
import type { MockRouteResponse, MockCall, SendRequest } from './types.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import { MockRuleStore } from './MockRuleStore.js';

export class MockManager implements MockAdapter {
  /** @internal */ _ruleStore = new MockRuleStore();

  constructor(private sendRequest: SendRequest) {}

  /** Alias for MockAdapter compatibility. */
  async addRoute(pattern: string, response: MockRouteResponse): Promise<void> {
    await this.route(pattern, response);
  }

  async route(path: string, response: MockRouteResponse & { method?: string }): Promise<void> {
    const config = {
      path,
      method: response.method,
      response: {
        status: response.status,
        headers: response.headers,
        body: response.body,
        delay: response.delay,
      },
    };
    await this.sendRequest('ext.fliwright.mock.addRoute', {
      route: JSON.stringify(config),
    });
  }

  async removeRoute(path: string): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.removeRoute', { path });
  }

  async clear(): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.clearRoutes', {});
  }

  async setPassthrough(enabled: boolean): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.setPassthrough', {
      enabled: String(enabled),
    });
  }

  async getCalls(path?: string): Promise<MockCall[]> {
    const params = path ? { path } : {};
    const result = (await this.sendRequest('ext.fliwright.mock.getCalls', params)) as {
      calls: MockCall[];
    };
    return result.calls ?? [];
  }

  async listRoutes(): Promise<Array<{ id: string; method?: string; path: string }>> {
    const result = (await this.sendRequest('ext.fliwright.mock.listRoutes', {})) as {
      routes: Array<{ id: string; method?: string; path: string }>;
    };
    return result.routes ?? [];
  }

  async clearCalls(): Promise<void> {
    await this.sendRequest('ext.fliwright.mock.clearCalls', {});
  }

  // --- Rule switching API ---

  /**
   * Load mock rules from a directory and apply all active rules to Flutter.
   * Defaults to `.fliwright/mocks` if no path given.
   * Silently skips if directory or index file doesn't exist.
   */
  async loadRules(mockDir?: string): Promise<void> {
    const dir = mockDir ?? '.fliwright/mocks';
    await this._ruleStore.loadFromDirectory(dir);

    for (const ep of this._ruleStore.listEndpoints()) {
      const response = this._ruleStore.getActiveResponse(ep.endpoint);
      if (response) {
        await this.route(ep.endpoint, { ...response, method: ep.method });
      }
    }
  }

  /**
   * List all loaded endpoints with their available rules and current active rule.
   * Returns empty array if loadRules() hasn't been called.
   */
  listRules(): Array<{
    endpoint: string;
    method: string;
    rules: string[];
    activeRule: string;
  }> {
    return this._ruleStore.listEndpoints();
  }

  /**
   * Switch the active rule for an endpoint and apply it to the Flutter mock server.
   * Throws if the endpoint or rule name is not found.
   */
  async switchRule(endpoint: string, ruleName: string): Promise<void> {
    const response = this._ruleStore.switchRule(endpoint, ruleName);
    if (response) {
      const entry = this._ruleStore.listEndpoints().find((e) => e.endpoint === endpoint);
      await this.route(endpoint, { ...response, method: entry?.method });
    }
  }
}
```

- [ ] **Step 4: Export MockRuleStore from index.ts**

In `packages/fliwright-core/src/index.ts`, add after the `MockManager` export line (line 49):

```typescript
export { MockRuleStore } from './MockRuleStore.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run test -- --reporter=verbose tests/MockManager.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run test`
Expected: All tests PASS (both old and new)

- [ ] **Step 7: Run type check**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run lint`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/fliwright-core/src/MockManager.ts packages/fliwright-core/tests/MockManager.test.ts packages/fliwright-core/src/index.ts
git commit -m "feat(core): add loadRules, listRules, switchRule to MockManager"
```

---

### Task 4: Add MCP tools for mock rule switching

**Files:**
- Create: `packages/fliwright-mcp/src/tools/mockTools.ts`
- Modify: `packages/fliwright-mcp/src/state.ts`
- Modify: `packages/fliwright-mcp/src/server.ts`

- [ ] **Step 1: Add MockRuleStore to MCP server state**

Add to `packages/fliwright-mcp/src/state.ts`. Insert a new import and extend the `ServerState` interface and `createServerState` factory:

Full replacement for `packages/fliwright-mcp/src/state.ts`:

```typescript
import type { RunResult, FailureEntry } from './types.js';
import type { MockRuleStore } from '@fliwright/core';

export interface ServerState {
  getLastRunResult(): RunResult | null;
  setLastRunResult(result: RunResult): void;
  getLastFailures(): FailureEntry[];
  setLastFailures(failures: FailureEntry[]): void;
  getFailuresByTestName(testName?: string): FailureEntry[];
  getVmServiceUrl(): string | null;
  setVmServiceUrl(url: string): void;
  getRuleStore(): MockRuleStore;
}

export function createServerState(): ServerState {
  let lastRunResult: RunResult | null = null;
  let lastFailures: FailureEntry[] = [];
  let vmServiceUrl: string | null = null;

  // Lazy-init MockRuleStore — imported dynamically to keep startup clean
  let ruleStore: MockRuleStore | null = null;

  return {
    getLastRunResult() { return lastRunResult; },
    setLastRunResult(result: RunResult) { lastRunResult = result; },
    getLastFailures() { return lastFailures; },
    setLastFailures(failures: FailureEntry[]) { lastFailures = failures; },
    getFailuresByTestName(testName?: string): FailureEntry[] {
      if (!testName) return lastFailures;
      return lastFailures.filter((f) => f.testName === testName);
    },
    getVmServiceUrl() { return vmServiceUrl; },
    setVmServiceUrl(url: string) { vmServiceUrl = url; },
    getRuleStore(): MockRuleStore {
      if (!ruleStore) {
        const { MockRuleStore } = require('@fliwright/core') as typeof import('@fliwright/core');
        ruleStore = new MockRuleStore();
      }
      return ruleStore;
    },
  };
}
```

Wait — the project uses ESM (`"type": "module"`), so `require` won't work. Use a dynamic import pattern instead:

Full replacement for `packages/fliwright-mcp/src/state.ts`:

```typescript
import type { RunResult, FailureEntry } from './types.js';
import { MockRuleStore } from '@fliwright/core';

export interface ServerState {
  getLastRunResult(): RunResult | null;
  setLastRunResult(result: RunResult): void;
  getLastFailures(): FailureEntry[];
  setLastFailures(failures: FailureEntry[]): void;
  getFailuresByTestName(testName?: string): FailureEntry[];
  getVmServiceUrl(): string | null;
  setVmServiceUrl(url: string): void;
  getRuleStore(): MockRuleStore;
}

export function createServerState(): ServerState {
  let lastRunResult: RunResult | null = null;
  let lastFailures: FailureEntry[] = [];
  let vmServiceUrl: string | null = null;
  const ruleStore = new MockRuleStore();

  return {
    getLastRunResult() { return lastRunResult; },
    setLastRunResult(result: RunResult) { lastRunResult = result; },
    getLastFailures() { return lastFailures; },
    setLastFailures(failures: FailureEntry[]) { lastFailures = failures; },
    getFailuresByTestName(testName?: string): FailureEntry[] {
      if (!testName) return lastFailures;
      return lastFailures.filter((f) => f.testName === testName);
    },
    getVmServiceUrl() { return vmServiceUrl; },
    setVmServiceUrl(url: string) { vmServiceUrl = url; },
    getRuleStore(): MockRuleStore { return ruleStore; },
  };
}
```

- [ ] **Step 2: Create the MCP tool file**

Create `packages/fliwright-mcp/src/tools/mockTools.ts`:

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';

export const MockListParamsSchema = z.object({});

export const MockSwitchParamsSchema = z.object({
  mockDir: z.string().optional().describe('Path to .fliwright/mocks directory. Defaults to .fliwright/mocks.'),
  endpoint: z.string().describe('API endpoint path, e.g. "/v1/public/token"'),
  ruleName: z.string().describe('Name of the rule to activate, e.g. "success", "empty", "server_error"'),
});

export function registerMockListTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_list',
    'List all mock API endpoints, their available rules, and currently active rule',
    MockListParamsSchema.shape,
    async () => {
      const store = state.getRuleStore();
      const endpoints = store.listEndpoints();

      if (endpoints.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No mock rules loaded. Place config files in .fliwright/mocks/ and call fliwright_mock_list with a loadDir parameter, or ensure mock-index.json exists.',
          }],
        };
      }

      const lines = endpoints.map((ep) => {
        const rules = ep.rules.map((r) => r === ep.activeRule ? `${r} ✓` : r).join(', ');
        return `${ep.method} ${ep.endpoint} — [${rules}]`;
      });

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );
}

export function registerMockSwitchTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_switch',
    'Switch the active mock rule for a specific API endpoint. The endpoint must have been loaded from .fliwright/mocks/ config files.',
    MockSwitchParamsSchema.shape,
    async (params) => {
      const store = state.getRuleStore();

      if (!store.isLoaded) {
        const dir = params.mockDir ?? '.fliwright/mocks';
        await store.loadFromDirectory(dir);
      }

      try {
        store.switchRule(params.endpoint, params.ruleName);

        const endpoints = store.listEndpoints();
        const ep = endpoints.find((e) => e.endpoint === params.endpoint);
        const summary = ep
          ? `${ep.method} ${ep.endpoint} → ${ep.activeRule}`
          : `${params.endpoint} → ${params.ruleName}`;

        return {
          content: [{ type: 'text' as const, text: `Switched: ${summary}` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
```

- [ ] **Step 3: Register the new tools in server.ts**

In `packages/fliwright-mcp/src/server.ts`, add imports and registrations:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createServerState } from './state.js';
import { registerRunTestTool } from './tools/runTest.js';
import { registerGetFailureTool } from './tools/getFailure.js';
import { registerGenerateTestTool } from './tools/generateTest.js';
import { registerRecordTool } from './tools/record.js';
import { registerMockListTool, registerMockSwitchTool } from './tools/mockTools.js';
import { registerTestReportResource } from './resources/testReport.js';

export function createFliwrightServer() {
  const server = new McpServer({
    name: 'fliwright',
    version: '0.1.0',
  });

  const state = createServerState();

  registerRunTestTool(server, state);
  registerGetFailureTool(server, state);
  registerGenerateTestTool(server, state);
  registerRecordTool(server, state);
  registerMockListTool(server, state);
  registerMockSwitchTool(server, state);
  registerTestReportResource(server, state);

  return { server, state };
}
```

- [ ] **Step 4: Run type check**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/mcp run lint`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-mcp/src/tools/mockTools.ts packages/fliwright-mcp/src/state.ts packages/fliwright-mcp/src/server.ts
git commit -m "feat(mcp): add fliwright_mock_list and fliwright_mock_switch MCP tools"
```

---

### Task 5: Final validation — run all tests and type checks

**Files:** None (validation only)

- [ ] **Step 1: Run full core test suite**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run test`
Expected: All tests PASS

- [ ] **Step 2: Run MCP type check**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/mcp run lint`
Expected: No errors

- [ ] **Step 3: Run core type check**

Run: `cd /Volumes/HIKSEMI/project/fliwright && pnpm --filter @fliwright/core run lint`
Expected: No errors

- [ ] **Step 4: Verify exports**

Run: `cd /Volumes/HIKSEMI/project/fliwright && node -e "import('@fliwright/core').then(m => { console.log('MockRuleStore:', typeof m.MockRuleStore); console.log('MockManager:', typeof m.MockManager); console.log('MockRule:', typeof m.MockRule); })"`
Expected: All types print `function` or `undefined` (types don't appear at runtime, but classes should be `function`)
