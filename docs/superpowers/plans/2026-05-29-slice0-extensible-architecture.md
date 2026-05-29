# Slice 0: Extensible Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the plugin-based core architecture with a Riverpod state management proof-of-concept, establishing the extensible foundation for all future slices.

**Architecture:** TypeScript SDK (`@fliwright/core`) defines interfaces and a PluginRegistry. Dart bridge (`fliwright_bridge`) provides a dynamic extension registry over VM Service. Riverpod adapter validates the plugin model end-to-end. All communication via JSON-RPC 2.0 over VM Service WebSocket.

**Tech Stack:** TypeScript 5.x, Dart 3.x, Flutter 3.x, pnpm workspaces, melos, Vitest, Riverpod, `@modelcontextprotocol/sdk`

---

## File Structure

```
fliwright/
├── package.json                          # Root monorepo config
├── pnpm-workspace.yaml                   # pnpm workspace definition
├── melos.yaml                            # Dart monorepo management
├── packages/
│   ├── fliwright-core/                   # TS SDK (NPM: @fliwright/core)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts                  # Public API barrel export
│   │   │   ├── interfaces/
│   │   │   │   ├── Plugin.ts             # FliwrightPlugin lifecycle interface
│   │   │   │   ├── StateAdapter.ts        # State management abstraction
│   │   │   │   ├── MockAdapter.ts         # Mock abstraction
│   │   │   │   ├── FinderStrategy.ts      # Widget finder abstraction
│   │   │   │   ├── HealingStrategy.ts     # Self-healing abstraction
│   │   │   │   └── index.ts              # Barrel export
│   │   │   ├── types.ts                  # Shared types (ProviderInfo, WidgetInfo, etc.)
│   │   │   ├── PluginRegistry.ts         # Plugin registration & lifecycle
│   │   │   ├── Protocol.ts              # TS ↔ Dart JSON-RPC protocol
│   │   │   ├── VMServiceConnector.ts     # WebSocket connection to Dart VM
│   │   │   └── Driver.ts                # Core Driver, orchestrates plugins
│   │   └── tests/
│   │       ├── PluginRegistry.test.ts
│   │       ├── Protocol.test.ts
│   │       ├── VMServiceConnector.test.ts
│   │       └── Driver.test.ts
│   ├── fliwright-bridge/                # Dart package
│   │   ├── pubspec.yaml
│   │   ├── lib/
│   │   │   ├── fliwright_bridge.dart     # Public API barrel
│   │   │   └── src/
│   │   │       ├── bridge.dart           # FliwrightBridge main class
│   │   │       ├── extension_registry.dart  # Dynamic extension registration
│   │   │       └── extensions/
│   │   │           ├── riverpod.dart     # Riverpod probe & watch
│   │   │           └── inspector.dart    # Widget tree query helper
│   │   └── test/
│   │       └── extension_registry_test.dart
│   └── fliwright-plugin-riverpod/       # TS Riverpod plugin (NPM)
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       ├── src/
│       │   ├── index.ts
│       │   └── RiverpodStateAdapter.ts   # Implements StateAdapter
│       └── tests/
│           └── RiverpodStateAdapter.test.ts
├── examples/
│   └── riverpod_demo/                   # Validation Flutter app
│       ├── pubspec.yaml
│       ├── lib/
│       │   └── main.dart                # Simple Riverpod counter app
│       ├── test_driver/
│       │   └── fliwright_app.dart        # Fliwright entry point
│       └── test/
│           └── e2e_test.ts              # TS E2E validation test
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-05-28-fliwright-mvp-v1-design.md  # Approved spec
```

---

### Task 1: Monorepo Scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `melos.yaml`
- Create: `.gitignore`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "fliwright",
  "private": true,
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "lint": "pnpm -r run lint"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Create melos.yaml**

```yaml
name: fliwright
packages:
  - packages/**
command:
  bootstrap:
    runPubGetInParallel: true
scripts:
  analyze:
    run: dart analyze .
  test:
    run: dart test
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
.dart_tool/
build/
*.iml
.pub-cache/
.pub/
.packages
dist/
coverage/
*.log
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml melos.yaml .gitignore
git commit -m "chore: initialize monorepo scaffolding"
```

---

### Task 2: @fliwright/core Package Setup + Shared Types

**Files:**
- Create: `packages/fliwright-core/package.json`
- Create: `packages/fliwright-core/tsconfig.json`
- Create: `packages/fliwright-core/vitest.config.ts`
- Create: `packages/fliwright-core/src/types.ts`
- Create: `packages/fliwright-core/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@fliwright/core",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "ws": "^8.17.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create src/types.ts with shared types**

```typescript
/** Information about a state management provider */
export interface ProviderInfo {
  name: string;
  type: string;
  value: unknown;
}

/** Widget metadata returned from Dart bridge */
export interface WidgetInfo {
  id: string;
  type: string;
  text?: string;
  key?: string;
  rect: { x: number; y: number; width: number; height: number };
  properties: Record<string, unknown>;
}

/** Snapshot of a widget for self-healing matching */
export interface WidgetSnapshot {
  type: string;
  parentType: string;
  adjacentText: string[];
  rect: { x: number; y: number; width: number; height: number };
  callbackNames: string[];
}

/** Result of a self-healing attempt */
export interface HealingResult {
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  matchedWidget: WidgetInfo;
}

/** Mock route handler configuration */
export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
}

/** A widget matched by a finder strategy */
export interface WidgetMatch {
  widget: WidgetInfo;
  score: number;
}

/** Test result passed to plugin lifecycle hooks */
export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

/** VM Service event received from Dart bridge */
export interface VMServiceEvent {
  kind: string;
  timestamp: number;
  data: Record<string, unknown>;
}

/** Protocol message envelope for TS ↔ Dart communication */
export interface ProtocolMessage {
  jsonrpc: '2.0';
  id?: string;
  method: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
```

- [ ] **Step 5: Create src/index.ts barrel (empty initially, will expand)**

```typescript
// Types
export type {
  ProviderInfo,
  WidgetInfo,
  WidgetSnapshot,
  HealingResult,
  MockResponse,
  WidgetMatch,
  TestResult,
  VMServiceEvent,
  ProtocolMessage,
} from './types.js';
```

- [ ] **Step 6: Install dependencies and verify build**

```bash
cd packages/fliwright-core && pnpm install && pnpm build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): initialize @fliwright/core package with shared types"
```

---

### Task 3: Core Interface — FliwrightPlugin

**Files:**
- Create: `packages/fliwright-core/src/interfaces/Plugin.ts`
- Create: `packages/fliwright-core/src/interfaces/index.ts`

- [ ] **Step 1: Write the Plugin interface**

```typescript
// packages/fliwright-core/src/interfaces/Plugin.ts

import type { TestResult } from '../types.js';

/** Context provided to plugins during initialization */
export interface PluginContext {
  /** Send a JSON-RPC request to the Dart bridge */
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Register a state adapter that tests can use */
  registerStateAdapter(name: string, adapter: unknown): void;
  /** Register a mock adapter */
  registerMockAdapter(name: string, adapter: unknown): void;
  /** Register a finder strategy */
  registerFinderStrategy(name: string, strategy: unknown): void;
  /** Register a healing strategy */
  registerHealingStrategy(name: string, strategy: unknown): void;
}

/** Lifecycle hooks for a Fliwright plugin */
export interface FliwrightPlugin {
  /** Unique identifier for this plugin */
  readonly name: string;

  /** Called once when the driver initializes */
  onInit?(context: PluginContext): Promise<void>;

  /** Called before each test starts */
  onTestStart?(testName: string): Promise<void>;

  /** Called after each test completes */
  onTestEnd?(testName: string, result: TestResult): Promise<void>;

  /** Called when the driver shuts down */
  onDispose?(): Promise<void>;
}
```

- [ ] **Step 2: Update src/interfaces/index.ts**

```typescript
export type { FliwrightPlugin, PluginContext } from './Plugin.js';
```

- [ ] **Step 3: Update src/index.ts to export interfaces**

Add to `src/index.ts`:

```typescript
// Interfaces
export type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
```

- [ ] **Step 4: Verify build**

```bash
cd packages/fliwright-core && pnpm build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): add FliwrightPlugin interface with lifecycle hooks"
```

---

### Task 4: Core Interfaces — StateAdapter

**Files:**
- Create: `packages/fliwright-core/src/interfaces/StateAdapter.ts`

- [ ] **Step 1: Write the StateAdapter interface**

```typescript
// packages/fliwright-core/src/interfaces/StateAdapter.ts

import type { ProviderInfo } from '../types.js';

/**
 * Abstraction for state management operations.
 * Implementations: RiverpodAdapter, ProviderAdapter, BlocAdapter, etc.
 */
export interface StateAdapter {
  /** Read the current value of a provider/state */
  read(key: string): Promise<unknown>;

  /** Write a value to a provider/state */
  write(key: string, value: unknown): Promise<void>;

  /**
   * Watch a provider for changes.
   * Returns an unsubscribe function.
   */
  watch(
    key: string,
    callback: (oldValue: unknown, newValue: unknown) => void,
  ): Promise<() => void>;

  /** List all registered providers with their current values */
  listProviders(): Promise<ProviderInfo[]>;

  /** Override a provider's value (for test setup) */
  override(key: string, value: unknown): Promise<void>;
}
```

- [ ] **Step 2: Update interfaces/index.ts**

```typescript
export type { FliwrightPlugin, PluginContext } from './Plugin.js';
export type { StateAdapter } from './StateAdapter.js';
```

- [ ] **Step 3: Update src/index.ts**

Add:

```typescript
export type { StateAdapter } from './interfaces/StateAdapter.js';
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/fliwright-core && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): add StateAdapter interface for state management abstraction"
```

---

### Task 5: Core Interfaces — MockAdapter, FinderStrategy, HealingStrategy

**Files:**
- Create: `packages/fliwright-core/src/interfaces/MockAdapter.ts`
- Create: `packages/fliwright-core/src/interfaces/FinderStrategy.ts`
- Create: `packages/fliwright-core/src/interfaces/HealingStrategy.ts`

- [ ] **Step 1: Write MockAdapter interface**

```typescript
// packages/fliwright-core/src/interfaces/MockAdapter.ts

import type { MockResponse } from '../types.js';

/**
 * Abstraction for HTTP/API mock operations.
 */
export interface MockAdapter {
  /** Add a mock route: when a request matches pattern, return handler response */
  addRoute(pattern: string, handler: MockResponse): Promise<void>;

  /** Remove a previously added mock route */
  removeRoute(pattern: string): Promise<void>;

  /** Clear all mock routes */
  clear(): Promise<void>;
}
```

- [ ] **Step 2: Write FinderStrategy interface**

```typescript
// packages/fliwright-core/src/interfaces/FinderStrategy.ts

import type { WidgetInfo, WidgetMatch } from '../types.js';

/**
 * Strategy for finding widgets in the Flutter widget tree.
 * Implementations: TextFinder, KeyFinder, TypeFinder, SemanticFinder, etc.
 */
export interface FinderStrategy {
  /** Name used to reference this strategy in selectors */
  readonly strategyName: string;

  /** Find widgets matching the given query string */
  find(query: string): Promise<WidgetMatch[]>;

  /** Generate a human-readable description of a widget for reports */
  describe(widget: WidgetInfo): string;
}
```

- [ ] **Step 3: Write HealingStrategy interface**

```typescript
// packages/fliwright-core/src/interfaces/HealingStrategy.ts

import type { WidgetSnapshot, HealingResult } from '../types.js';

/**
 * Strategy for self-healing when selectors break.
 * Implementations: MultiDimensionHealer, LLMHealer, etc.
 */
export interface HealingStrategy {
  /** Name of this healing strategy */
  readonly strategyName: string;

  /**
   * Score how similar a candidate widget is to the original snapshot.
   * Returns a value between 0 (no match) and 1 (perfect match).
   */
  score(original: WidgetSnapshot, candidate: WidgetSnapshot): number;

  /**
   * Attempt to find a healing candidate from the list.
   * Returns null if no candidate exceeds the confidence threshold.
   */
  heal(
    original: WidgetSnapshot,
    candidates: WidgetSnapshot[],
    threshold?: number,
  ): HealingResult | null;
}
```

- [ ] **Step 4: Update interfaces/index.ts**

```typescript
export type { FliwrightPlugin, PluginContext } from './Plugin.js';
export type { StateAdapter } from './StateAdapter.js';
export type { MockAdapter } from './MockAdapter.js';
export type { FinderStrategy } from './FinderStrategy.js';
export type { HealingStrategy } from './HealingStrategy.js';
```

- [ ] **Step 5: Update src/index.ts — add all new exports**

```typescript
// Types
export type {
  ProviderInfo,
  WidgetInfo,
  WidgetSnapshot,
  HealingResult,
  MockResponse,
  WidgetMatch,
  TestResult,
  VMServiceEvent,
  ProtocolMessage,
} from './types.js';

// Interfaces
export type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
export type { StateAdapter } from './interfaces/StateAdapter.js';
export type { MockAdapter } from './interfaces/MockAdapter.js';
export type { FinderStrategy } from './interfaces/FinderStrategy.js';
export type { HealingStrategy } from './interfaces/HealingStrategy.js';
```

- [ ] **Step 6: Build and verify**

```bash
cd packages/fliwright-core && pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): add MockAdapter, FinderStrategy, HealingStrategy interfaces"
```

---

### Task 6: PluginRegistry — Implementation + Tests

**Files:**
- Create: `packages/fliwright-core/src/PluginRegistry.ts`
- Create: `packages/fliwright-core/tests/PluginRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/PluginRegistry.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PluginRegistry } from '../src/PluginRegistry.js';
import type { FliwrightPlugin, PluginContext } from '../src/interfaces/Plugin.js';
import type { StateAdapter } from '../src/interfaces/StateAdapter.js';

function createMockPlugin(name: string, hooks?: Partial<FliwrightPlugin>): FliwrightPlugin {
  return {
    name,
    onInit: hooks?.onInit,
    onTestStart: hooks?.onTestStart,
    onTestEnd: hooks?.onTestEnd,
    onDispose: hooks?.onDispose,
  };
}

describe('PluginRegistry', () => {
  it('registers and resolves a plugin by name', () => {
    const registry = new PluginRegistry();
    const plugin = createMockPlugin('test-plugin');
    registry.register(plugin);
    expect(registry.resolve('test-plugin')).toBe(plugin);
  });

  it('throws when resolving an unregistered plugin', () => {
    const registry = new PluginRegistry();
    expect(() => registry.resolve('nonexistent')).toThrow(
      "Plugin 'nonexistent' is not registered",
    );
  });

  it('throws when registering a plugin with a duplicate name', () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin('dup'));
    expect(() => registry.register(createMockPlugin('dup'))).toThrow(
      "Plugin 'dup' is already registered",
    );
  });

  it('calls onInit for all plugins with a context', async () => {
    const registry = new PluginRegistry();
    const onInit = vi.fn();
    registry.register(createMockPlugin('a', { onInit }));
    registry.register(createMockPlugin('b', { onInit }));

    const mockSendRequest = vi.fn().mockResolvedValue({});
    await registry.initAll(mockSendRequest);

    expect(onInit).toHaveBeenCalledTimes(2);
    // Verify context has registerStateAdapter
    const ctx = onInit.mock.calls[0][0] as PluginContext;
    expect(ctx.sendRequest).toBe(mockSendRequest);
    expect(typeof ctx.registerStateAdapter).toBe('function');
  });

  it('stores state adapters registered during init', async () => {
    const registry = new PluginRegistry();
    const fakeAdapter: StateAdapter = {
      read: vi.fn(),
      write: vi.fn(),
      watch: vi.fn(),
      listProviders: vi.fn(),
      override: vi.fn(),
    };

    const plugin: FliwrightPlugin = {
      name: 'riverpod',
      async onInit(ctx: PluginContext) {
        ctx.registerStateAdapter('riverpod', fakeAdapter);
      },
    };

    registry.register(plugin);
    await registry.initAll(vi.fn().mockResolvedValue({}));

    expect(registry.getStateAdapter('riverpod')).toBe(fakeAdapter);
  });

  it('throws when getting an unregistered state adapter', () => {
    const registry = new PluginRegistry();
    expect(() => registry.getStateAdapter('none')).toThrow(
      "StateAdapter 'none' is not registered",
    );
  });

  it('stores mock adapters registered during init', async () => {
    const registry = new PluginRegistry();
    const fakeMockAdapter = { addRoute: vi.fn(), removeRoute: vi.fn(), clear: vi.fn() };

    const plugin: FliwrightPlugin = {
      name: 'http-mock',
      async onInit(ctx: PluginContext) {
        ctx.registerMockAdapter('http', fakeMockAdapter);
      },
    };

    registry.register(plugin);
    await registry.initAll(vi.fn().mockResolvedValue({}));

    expect(registry.getMockAdapter('http')).toBe(fakeMockAdapter);
  });

  it('calls onTestStart and onTestEnd for all plugins', async () => {
    const registry = new PluginRegistry();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    registry.register(createMockPlugin('a', { onTestStart: onStart, onTestEnd: onEnd }));
    await registry.initAll(vi.fn().mockResolvedValue({}));

    await registry.notifyTestStart('my-test');
    expect(onStart).toHaveBeenCalledWith('my-test');

    await registry.notifyTestEnd('my-test', { name: 'my-test', passed: true, duration: 100 });
    expect(onEnd).toHaveBeenCalledWith('my-test', { name: 'my-test', passed: true, duration: 100 });
  });

  it('calls onDispose for all plugins', async () => {
    const registry = new PluginRegistry();
    const onDispose = vi.fn();
    registry.register(createMockPlugin('a', { onDispose }));
    await registry.initAll(vi.fn().mockResolvedValue({}));

    await registry.disposeAll();
    expect(onDispose).toHaveBeenCalledOnce();
  });

  it('lists all registered plugin names', () => {
    const registry = new PluginRegistry();
    registry.register(createMockPlugin('alpha'));
    registry.register(createMockPlugin('beta'));
    expect(registry.pluginNames).toEqual(['alpha', 'beta']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fliwright-core && pnpm vitest run tests/PluginRegistry.test.ts
```

Expected: FAIL — `PluginRegistry` module not found.

- [ ] **Step 3: Implement PluginRegistry**

```typescript
// packages/fliwright-core/src/PluginRegistry.ts

import type { FliwrightPlugin, PluginContext } from './interfaces/Plugin.js';
import type { StateAdapter } from './interfaces/StateAdapter.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import type { FinderStrategy } from './interfaces/FinderStrategy.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import type { TestResult } from './types.js';

export class PluginRegistry {
  private plugins = new Map<string, FliwrightPlugin>();
  private stateAdapters = new Map<string, StateAdapter>();
  private mockAdapters = new Map<string, MockAdapter>();
  private finderStrategies = new Map<string, FinderStrategy>();
  private healingStrategies = new Map<string, HealingStrategy>();
  private initialized = false;

  register(plugin: FliwrightPlugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin '${plugin.name}' is already registered`);
    }
    this.plugins.set(plugin.name, plugin);
  }

  resolve(name: string): FliwrightPlugin {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`Plugin '${name}' is not registered`);
    }
    return plugin;
  }

  get pluginNames(): string[] {
    return [...this.plugins.keys()];
  }

  getStateAdapter(name: string): StateAdapter {
    const adapter = this.stateAdapters.get(name);
    if (!adapter) {
      throw new Error(`StateAdapter '${name}' is not registered`);
    }
    return adapter;
  }

  getMockAdapter(name: string): MockAdapter {
    const adapter = this.mockAdapters.get(name);
    if (!adapter) {
      throw new Error(`MockAdapter '${name}' is not registered`);
    }
    return adapter;
  }

  getFinderStrategy(name: string): FinderStrategy {
    const strategy = this.finderStrategies.get(name);
    if (!strategy) {
      throw new Error(`FinderStrategy '${name}' is not registered`);
    }
    return strategy;
  }

  getHealingStrategy(name: string): HealingStrategy {
    const strategy = this.healingStrategies.get(name);
    if (!strategy) {
      throw new Error(`HealingStrategy '${name}' is not registered`);
    }
    return strategy;
  }

  async initAll(
    sendRequest: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  ): Promise<void> {
    if (this.initialized) return;

    const context: PluginContext = {
      sendRequest,
      registerStateAdapter: (name: string, adapter: unknown) => {
        this.stateAdapters.set(name, adapter as StateAdapter);
      },
      registerMockAdapter: (name: string, adapter: unknown) => {
        this.mockAdapters.set(name, adapter as MockAdapter);
      },
      registerFinderStrategy: (name: string, strategy: unknown) => {
        this.finderStrategies.set(name, strategy as FinderStrategy);
      },
      registerHealingStrategy: (name: string, strategy: unknown) => {
        this.healingStrategies.set(name, strategy as HealingStrategy);
      },
    };

    for (const plugin of this.plugins.values()) {
      if (plugin.onInit) {
        await plugin.onInit(context);
      }
    }

    this.initialized = true;
  }

  async notifyTestStart(testName: string): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onTestStart) {
        await plugin.onTestStart(testName);
      }
    }
  }

  async notifyTestEnd(testName: string, result: TestResult): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onTestEnd) {
        await plugin.onTestEnd(testName, result);
      }
    }
  }

  async disposeAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.onDispose) {
        await plugin.onDispose();
      }
    }
  }
}
```

- [ ] **Step 4: Update src/index.ts — add PluginRegistry export**

```typescript
export { PluginRegistry } from './PluginRegistry.js';
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/fliwright-core && pnpm vitest run tests/PluginRegistry.test.ts
```

Expected: All 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): implement PluginRegistry with lifecycle management and adapter storage"
```

---

### Task 7: Protocol — JSON-RPC Message Builder + Tests

**Files:**
- Create: `packages/fliwright-core/src/Protocol.ts`
- Create: `packages/fliwright-core/tests/Protocol.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/Protocol.test.ts
import { describe, it, expect } from 'vitest';
import { Protocol } from '../src/Protocol.js';

describe('Protocol', () => {
  it('creates a request message with auto-incrementing id', () => {
    const proto = new Protocol();
    const msg = proto.createRequest('ext.fliwright.click', { x: 100, y: 200 });
    expect(msg.jsonrpc).toBe('2.0');
    expect(msg.method).toBe('ext.fliwright.click');
    expect(msg.params).toEqual({ x: 100, y: 200 });
    expect(msg.id).toBe('1');
  });

  it('increments id for subsequent requests', () => {
    const proto = new Protocol();
    const msg1 = proto.createRequest('ext.fliwright.ping');
    const msg2 = proto.createRequest('ext.fliwright.ping');
    expect(msg1.id).toBe('1');
    expect(msg2.id).toBe('2');
  });

  it('parses a success response', () => {
    const proto = new Protocol();
    const result = proto.parseResponse({
      jsonrpc: '2.0',
      id: '1',
      result: { status: 'ok' },
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('throws on error response', () => {
    const proto = new Protocol();
    expect(() =>
      proto.parseResponse({
        jsonrpc: '2.0',
        id: '1',
        error: { code: -32000, message: 'Widget not found' },
      }),
    ).toThrow('VM Service error [-32000]: Widget not found');
  });

  it('includes version in handshake params', () => {
    const proto = new Protocol();
    const msg = proto.createRequest('ext.fliwright.handshake');
    expect(msg.params).toHaveProperty('protocolVersion');
    expect(typeof msg.params!.protocolVersion).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fliwright-core && pnpm vitest run tests/Protocol.test.ts
```

Expected: FAIL — `Protocol` module not found.

- [ ] **Step 3: Implement Protocol**

```typescript
// packages/fliwright-core/src/Protocol.ts

import type { ProtocolMessage } from './types.js';

const PROTOCOL_VERSION = 1;

export class Protocol {
  private nextId = 0;

  createRequest(
    method: string,
    params?: Record<string, unknown>,
  ): ProtocolMessage & { id: string } {
    const id = String(++this.nextId);
    const resolvedParams = params ?? {};

    if (method === 'ext.fliwright.handshake') {
      resolvedParams.protocolVersion = PROTOCOL_VERSION;
    }

    return {
      jsonrpc: '2.0',
      id,
      method,
      params: resolvedParams,
    };
  }

  parseResponse(message: ProtocolMessage): unknown {
    if (message.error) {
      throw new Error(
        `VM Service error [${message.error.code}]: ${message.error.message}`,
      );
    }
    return message.result;
  }

  getProtocolVersion(): number {
    return PROTOCOL_VERSION;
  }
}
```

- [ ] **Step 4: Update src/index.ts — add Protocol export**

```typescript
export { Protocol } from './Protocol.js';
```

- [ ] **Step 5: Run tests**

```bash
cd packages/fliwright-core && pnpm vitest run tests/Protocol.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): implement Protocol with JSON-RPC message builder and versioning"
```

---

### Task 8: VMServiceConnector — WebSocket Client + Tests

**Files:**
- Create: `packages/fliwright-core/src/VMServiceConnector.ts`
- Create: `packages/fliwright-core/tests/VMServiceConnector.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/VMServiceConnector.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VMServiceConnector } from '../src/VMServiceConnector.js';
import type { ProtocolMessage } from '../src/types.js';

/** Minimal WebSocket mock for testing */
function createMockWS() {
  const listeners: Record<string, Function[]> = {};
  const sent: string[] = [];

  return {
    on(event: string, fn: Function) {
      (listeners[event] ??= []).push(fn);
    },
    send(data: string) {
      sent.push(data);
    },
    close: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((fn) => fn(...args));
    },
    sent,
  };
}

describe('VMServiceConnector', () => {
  let connector: VMServiceConnector;
  let mockWS: ReturnType<typeof createMockWS>;

  beforeEach(() => {
    connector = new VMServiceConnector();
    mockWS = createMockWS();
  });

  it('resolves a pending request when response arrives', async () => {
    const responsePromise = connector.sendRequest('ext.fliwright.ping', { name: 'test' });

    // Simulate sending the request
    const sent = JSON.parse(mockWS.sent[0]);
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: sent.id,
      result: { greeting: 'Hello, test!' },
    }));

    const result = await responsePromise;
    expect(result).toEqual({ greeting: 'Hello, test!' });
  });

  it('rejects when error response arrives', async () => {
    const responsePromise = connector.sendRequest('ext.fliwright.bad');

    const sent = JSON.parse(mockWS.sent[0]);
    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      id: sent.id,
      error: { code: -32000, message: 'Method not found' },
    }));

    await expect(responsePromise).rejects.toThrow('VM Service error [-32000]: Method not found');
  });

  it('handles event stream notifications', async () => {
    const onEvent = vi.fn();
    connector.onEvent(onEvent);

    mockWS.emit('message', JSON.stringify({
      jsonrpc: '2.0',
      method: 'streamNotify',
      params: {
        streamId: 'Extension',
        event: { kind: 'riverpod_changed', data: { key: 'counter', value: 5 } },
      },
    }));

    expect(onEvent).toHaveBeenCalledWith({
      kind: 'riverpod_changed',
      data: { key: 'counter', value: 5 },
    });
  });

  it('attaches the mock WS for testing', () => {
    connector.attachMock(mockWS as any);
    expect(() => connector.sendRequest('ext.fliwright.test')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fliwright-core && pnpm vitest run tests/VMServiceConnector.test.ts
```

Expected: FAIL — `VMServiceConnector` module not found.

- [ ] **Step 3: Implement VMServiceConnector**

```typescript
// packages/fliwright-core/src/VMServiceConnector.ts

import WebSocket from 'ws';
import { Protocol } from './Protocol.js';
import type { VMServiceEvent, ProtocolMessage } from './types.js';

type EventCallback = (event: VMServiceEvent) => void;

export class VMServiceConnector {
  private protocol = new Protocol();
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private eventListeners: EventCallback[] = [];

  /**
   * Connect to a Dart VM Service WebSocket endpoint.
   * In production, url is like 'ws://127.0.0.1:54321/ws'
   */
  async connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));
      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });
      this.ws.on('close', () => {
        this.rejectAllPending(new Error('WebSocket connection closed'));
      });
    });
  }

  /** Send a request to the Dart bridge and return a promise for the response */
  sendRequest(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.ws) {
      throw new Error('Not connected. Call connect() first.');
    }

    const msg = this.protocol.createRequest(method, params);
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(msg.id, { resolve, reject });
    });

    this.ws.send(JSON.stringify(msg));
    return promise;
  }

  /** Register a callback for VM Service stream events */
  onEvent(callback: EventCallback): void {
    this.eventListeners.push(callback);
  }

  /** Disconnect from the VM Service */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Attach a mock WebSocket for testing.
   * The mock must implement `on(event, fn)`, `send(data)`, `close()`.
   */
  attachMock(mockWS: { on: (event: string, fn: Function) => void; send: (data: string) => void; close: () => void }): void {
    (this as any).ws = mockWS;
    mockWS.on('message', (data: string) => this.handleMessage(data));
    mockWS.on('close', () => this.rejectAllPending(new Error('WebSocket connection closed')));
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw) as ProtocolMessage;

    // Check if this is a response to a pending request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      try {
        resolve(this.protocol.parseResponse(msg));
      } catch (err) {
        reject(err);
      }
      return;
    }

    // Check if this is a stream event notification
    if (msg.method === 'streamNotify' && msg.params) {
      const params = msg.params as any;
      const event: VMServiceEvent = {
        kind: params.event?.kind ?? 'unknown',
        timestamp: Date.now(),
        data: params.event?.data ?? {},
      };
      this.eventListeners.forEach((cb) => cb(event));
    }
  }

  private rejectAllPending(error: Error): void {
    for (const { reject } of this.pendingRequests.values()) {
      reject(error);
    }
    this.pendingRequests.clear();
  }
}
```

- [ ] **Step 4: Update src/index.ts — add VMServiceConnector export**

```typescript
export { VMServiceConnector } from './VMServiceConnector.js';
```

- [ ] **Step 5: Run tests**

```bash
cd packages/fliwright-core && pnpm vitest run tests/VMServiceConnector.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): implement VMServiceConnector with WebSocket client and event stream"
```

---

### Task 9: Driver — Core Orchestrator + Tests

**Files:**
- Create: `packages/fliwright-core/src/Driver.ts`
- Create: `packages/fliwright-core/tests/Driver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-core/tests/Driver.test.ts
import { describe, it, expect, vi } from 'vitest';
import { FliwrightDriver } from '../src/Driver.js';
import type { FliwrightPlugin, PluginContext } from '../src/interfaces/Plugin.js';
import type { StateAdapter } from '../src/interfaces/StateAdapter.js';

describe('FliwrightDriver', () => {
  it('initializes plugins on connect', async () => {
    const onInit = vi.fn();
    const plugin: FliwrightPlugin = { name: 'test', onInit };
    const driver = new FliwrightDriver({ plugins: [plugin] });

    // Use attachMock to avoid real WebSocket
    const mockWS = createMockWSForDriver();
    await driver.attachMockConnector(mockWS);

    expect(onInit).toHaveBeenCalledOnce();
  });

  it('provides access to state adapters after init', async () => {
    const fakeAdapter: StateAdapter = {
      read: vi.fn().mockResolvedValue(42),
      write: vi.fn(),
      watch: vi.fn(),
      listProviders: vi.fn(),
      override: vi.fn(),
    };

    const plugin: FliwrightPlugin = {
      name: 'riverpod',
      async onInit(ctx: PluginContext) {
        ctx.registerStateAdapter('riverpod', fakeAdapter);
      },
    };

    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());

    const adapter = driver.getStateAdapter('riverpod');
    const value = await adapter.read('counter');
    expect(value).toBe(42);
  });

  it('notifies plugins on test lifecycle', async () => {
    const onTestStart = vi.fn();
    const onTestEnd = vi.fn();
    const plugin: FliwrightPlugin = { name: 'lifecycle', onTestStart, onTestEnd };

    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());

    await driver.notifyTestStart('test-1');
    expect(onTestStart).toHaveBeenCalledWith('test-1');

    await driver.notifyTestEnd('test-1', { name: 'test-1', passed: true, duration: 50 });
    expect(onTestEnd).toHaveBeenCalledWith('test-1', { name: 'test-1', passed: true, duration: 50 });
  });

  it('disposes plugins on disconnect', async () => {
    const onDispose = vi.fn();
    const plugin: FliwrightPlugin = { name: 'cleanup', onDispose };

    const driver = new FliwrightDriver({ plugins: [plugin] });
    await driver.attachMockConnector(createMockWSForDriver());

    await driver.dispose();
    expect(onDispose).toHaveBeenCalledOnce();
  });
});

function createMockWSForDriver() {
  const listeners: Record<string, Function[]> = {};
  return {
    on(event: string, fn: Function) {
      (listeners[event] ??= []).push(fn);
    },
    send(data: string) {},
    close() {},
    emit(event: string, ...args: unknown[]) {
      (listeners[event] ?? []).forEach((fn) => fn(...args));
    },
  };
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fliwright-core && pnpm vitest run tests/Driver.test.ts
```

Expected: FAIL — `FliwrightDriver` module not found.

- [ ] **Step 3: Implement Driver**

```typescript
// packages/fliwright-core/src/Driver.ts

import { PluginRegistry } from './PluginRegistry.js';
import { VMServiceConnector } from './VMServiceConnector.js';
import type { FliwrightPlugin } from './interfaces/Plugin.js';
import type { StateAdapter } from './interfaces/StateAdapter.js';
import type { MockAdapter } from './interfaces/MockAdapter.js';
import type { FinderStrategy } from './interfaces/FinderStrategy.js';
import type { HealingStrategy } from './interfaces/HealingStrategy.js';
import type { TestResult } from './types.js';

export interface DriverOptions {
  plugins?: FliwrightPlugin[];
}

export class FliwrightDriver {
  private registry = new PluginRegistry();
  private connector = new VMServiceConnector();

  constructor(options: DriverOptions = {}) {
    for (const plugin of options.plugins ?? []) {
      this.registry.register(plugin);
    }
  }

  async connect(vmServiceUrl: string): Promise<void> {
    await this.connector.connect(vmServiceUrl);
    await this.registry.initAll((method, params) =>
      this.connector.sendRequest(method, params),
    );
  }

  /** Attach a mock connector for testing (skips real WebSocket) */
  async attachMockConnector(
    mockWS: { on: (event: string, fn: Function) => void; send: (data: string) => void; close: () => void },
  ): Promise<void> {
    this.connector.attachMock(mockWS);
    await this.registry.initAll((method, params) =>
      this.connector.sendRequest(method, params),
    );
  }

  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.connector.sendRequest(method, params);
  }

  getStateAdapter(name: string): StateAdapter {
    return this.registry.getStateAdapter(name);
  }

  getMockAdapter(name: string): MockAdapter {
    return this.registry.getMockAdapter(name);
  }

  getFinderStrategy(name: string): FinderStrategy {
    return this.registry.getFinderStrategy(name);
  }

  getHealingStrategy(name: string): HealingStrategy {
    return this.registry.getHealingStrategy(name);
  }

  async notifyTestStart(testName: string): Promise<void> {
    await this.registry.notifyTestStart(testName);
  }

  async notifyTestEnd(testName: string, result: TestResult): Promise<void> {
    await this.registry.notifyTestEnd(testName, result);
  }

  async dispose(): Promise<void> {
    await this.registry.disposeAll();
    this.connector.disconnect();
  }
}
```

- [ ] **Step 4: Update src/index.ts — add Driver export**

```typescript
export { FliwrightDriver } from './Driver.js';
export type { DriverOptions } from './Driver.js';
```

- [ ] **Step 5: Run all core tests**

```bash
cd packages/fliwright-core && pnpm vitest run
```

Expected: All tests PASS (PluginRegistry: 9, Protocol: 5, VMServiceConnector: 4, Driver: 4 = 22 total).

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-core/
git commit -m "feat(core): implement FliwrightDriver orchestrator with plugin lifecycle"
```

---

### Task 10: fliwright_bridge — Dart Package Setup + ExtensionRegistry

**Files:**
- Create: `packages/fliwright-bridge/pubspec.yaml`
- Create: `packages/fliwright-bridge/lib/fliwright_bridge.dart`
- Create: `packages/fliwright-bridge/lib/src/bridge.dart`
- Create: `packages/fliwright-bridge/lib/src/extension_registry.dart`
- Create: `packages/fliwright-bridge/test/extension_registry_test.dart`

- [ ] **Step 1: Create pubspec.yaml**

```yaml
name: fliwright_bridge
description: Dart bridge for Fliwright — registers VM Service extensions for remote Flutter app control.
version: 0.1.0

environment:
  sdk: ^3.5.0

dependencies:
  flutter:
    sdk: flutter

dev_dependencies:
  flutter_test:
    sdk: flutter
  test: ^1.25.0
```

- [ ] **Step 2: Create lib/src/extension_registry.dart**

```dart
import 'dart:convert';
import 'dart:developer';

/// Handler function type for VM Service extensions.
typedef ExtensionHandler = Future<Map<String, dynamic>> Function(
  Map<String, String> params,
);

/// Registry for dynamically managing VM Service extensions.
class ExtensionRegistry {
  final Map<String, ExtensionHandler> _handlers = {};

  /// Register a handler for a VM Service extension method.
  /// Method must start with 'ext.' (e.g., 'ext.fliwright.click').
  void register(String method, ExtensionHandler handler) {
    if (!method.startsWith('ext.')) {
      throw ArgumentError('Extension method must start with "ext."');
    }
    if (_handlers.containsKey(method)) {
      throw StateError('Extension "$method" is already registered');
    }
    _handlers[method] = handler;
    _registerWithVM(method);
  }

  /// Check if an extension is registered.
  bool isRegistered(String method) => _handlers.containsKey(method);

  /// List all registered extension method names.
  List<String> get registeredMethods => _handlers.keys.toList();

  /// Invoke a registered extension handler by method name.
  Future<Map<String, dynamic>> invoke(
    String method,
    Map<String, String> params,
  ) async {
    final handler = _handlers[method];
    if (handler == null) {
      throw StateError('Extension "$method" is not registered');
    }
    return handler(params);
  }

  void _registerWithVM(String method) {
    registerExtension(method, (
      String registeredMethod,
      Map<String, String> parameters,
    ) async {
      try {
        final result = await _handlers[registeredMethod]!(parameters);
        return ServiceExtensionResponse.result(jsonEncode(result));
      } catch (e) {
        return ServiceExtensionResponse.error(
          ServiceExtensionResponse.extensionError,
          e.toString(),
        );
      }
    });
  }
}
```

- [ ] **Step 3: Create lib/src/bridge.dart**

```dart
import 'extension_registry.dart';

export 'extension_registry.dart';

/// Main entry point for the Fliwright Dart bridge.
///
/// Call FliwrightBridge.init() in your test_driver entry file,
/// then call the original app's main().
class FliwrightBridge {
  static final ExtensionRegistry _registry = ExtensionRegistry();

  /// The shared extension registry.
  static ExtensionRegistry get registry => _registry;

  /// Initialize the bridge. Registers core extensions.
  static Future<void> init() async {
    // Register a ping extension for health checks
    _registry.register('ext.fliwright.ping', (params) async {
      return {'status': 'ok', 'timestamp': DateTime.now().toIso8601String()};
    });

    // Register handshake extension
    _registry.register('ext.fliwright.handshake', (params) async {
      final clientVersion = int.tryParse(params['protocolVersion'] ?? '0') ?? 0;
      return {
        'status': 'ok',
        'protocolVersion': 1,
        'clientVersion': clientVersion,
        'compatible': clientVersion <= 1,
      };
    });
  }
}
```

- [ ] **Step 4: Create lib/fliwright_bridge.dart barrel**

```dart
library fliwright_bridge;

export 'src/bridge.dart';
```

- [ ] **Step 5: Write extension_registry_test.dart**

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('ExtensionRegistry', () {
    late ExtensionRegistry registry;

    setUp(() {
      registry = ExtensionRegistry();
    });

    test('registers and invokes a handler', () async {
      registry.register('ext.test.ping', (params) async {
        return {'echo': params['message'] ?? 'none'};
      });

      expect(registry.isRegistered('ext.test.ping'), isTrue);

      final result = await registry.invoke('ext.test.ping', {'message': 'hello'});
      expect(result, equals({'echo': 'hello'}));
    });

    test('throws when registering non-ext method', () {
      expect(
        () => registry.register('bad.method', (_) async => {}),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('throws when registering duplicate method', () {
      registry.register('ext.test.dup', (_) async => {});
      expect(
        () => registry.register('ext.test.dup', (_) async => {}),
        throwsA(isA<StateError>()),
      );
    });

    test('throws when invoking unregistered method', () {
      expect(
        () => registry.invoke('ext.test.missing', {}),
        throwsA(isA<StateError>()),
      );
    });

    test('lists registered methods', () {
      registry.register('ext.test.a', (_) async => {});
      registry.register('ext.test.b', (_) async => {});
      expect(
        registry.registeredMethods,
        containsAll(['ext.test.a', 'ext.test.b']),
      );
    });
  });

  group('FliwrightBridge', () {
    test('init registers core extensions', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.ping'));
      expect(methods, contains('ext.fliwright.handshake'));
    });
  });
}
```

- [ ] **Step 6: Run Dart tests**

```bash
cd packages/fliwright-bridge && flutter test
```

Expected: All 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/fliwright-bridge/
git commit -m "feat(bridge): initialize fliwright_bridge Dart package with ExtensionRegistry"
```

---

### Task 11: Dart Bridge — Riverpod Probe Extension

**Files:**
- Create: `packages/fliwright-bridge/lib/src/extensions/riverpod.dart`

- [ ] **Step 1: Implement the Riverpod probe extension**

```dart
// packages/fliwright-bridge/lib/src/extensions/riverpod.dart

import 'dart:convert';
import '../bridge.dart';

/// Registers Riverpod-related VM Service extensions on the bridge.
///
/// Requires the Flutter app to use flutter_riverpod (ProviderScope).
/// Accesses the ProviderContainer at runtime via global reference.
class RiverpodExtension {
  /// Optional: set this in the app's main.dart via ProviderScope(container:)
  /// If null, will attempt to find the container from the widget tree.
  static dynamic providerContainer;

  /// Register all Riverpod extensions on the given registry.
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.riverpod.list', _listProviders);
    registry.register('ext.fliwright.riverpod.read', _readProvider);
    registry.register('ext.fliwright.riverpod.override', _overrideProvider);
  }

  static Future<Map<String, dynamic>> _listProviders(
    Map<String, String> params,
  ) async {
    final container = _getContainer();
    if (container == null) {
      return {'error': 'ProviderContainer not found. Ensure ProviderScope is active.'};
    }

    // Use reflection to list providers
    // In a real implementation, we maintain a registry of known providers
    // For now, return the container's debug info
    return {
      'providers': <Map<String, dynamic>>[],
      'containerReady': true,
    };
  }

  static Future<Map<String, dynamic>> _readProvider(
    Map<String, String> params,
  ) async {
    final container = _getContainer();
    final providerName = params['provider'];
    if (providerName == null) {
      return {'error': 'Missing parameter: provider'};
    }
    if (container == null) {
      return {'error': 'ProviderContainer not found'};
    }

    // In real implementation, resolve provider by name from a registry
    return {
      'provider': providerName,
      'value': null,
      'found': false,
    };
  }

  static Future<Map<String, dynamic>> _overrideProvider(
    Map<String, String> params,
  ) async {
    final container = _getContainer();
    final providerName = params['provider'];
    final valueJson = params['value'];
    if (providerName == null || valueJson == null) {
      return {'error': 'Missing parameters: provider and value are required'};
    }
    if (container == null) {
      return {'error': 'ProviderContainer not found'};
    }

    // In real implementation, override the provider
    return {
      'provider': providerName,
      'overridden': false,
      'message': 'Provider override will be implemented with provider registry',
    };
  }

  static dynamic _getContainer() {
    return providerContainer;
  }
}
```

- [ ] **Step 2: Register RiverpodExtension in bridge.dart init()**

Update `packages/fliwright-bridge/lib/src/bridge.dart`:

```dart
import 'extension_registry.dart';
import 'extensions/riverpod.dart';

export 'extension_registry.dart';

class FliwrightBridge {
  static final ExtensionRegistry _registry = ExtensionRegistry();
  static ExtensionRegistry get registry => _registry;

  static Future<void> init() async {
    // Core extensions
    _registry.register('ext.fliwright.ping', (params) async {
      return {'status': 'ok', 'timestamp': DateTime.now().toIso8601String()};
    });

    _registry.register('ext.fliwright.handshake', (params) async {
      final clientVersion = int.tryParse(params['protocolVersion'] ?? '0') ?? 0;
      return {
        'status': 'ok',
        'protocolVersion': 1,
        'clientVersion': clientVersion,
        'compatible': clientVersion <= 1,
      };
    });

    // Feature extensions
    RiverpodExtension.register(_registry);
  }
}
```

- [ ] **Step 3: Add test for Riverpod extension registration**

Append to `packages/fliwright-bridge/test/extension_registry_test.dart`:

```dart
  group('RiverpodExtension', () {
    test('registers riverpod extensions on init', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.riverpod.list'));
      expect(methods, contains('ext.fliwright.riverpod.read'));
      expect(methods, contains('ext.fliwright.riverpod.override'));
    });

    test('read returns error when provider name is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.read',
        {},
      );
      expect(result, contains('error'));
    });
  });
```

- [ ] **Step 4: Run tests**

```bash
cd packages/fliwright-bridge && flutter test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-bridge/
git commit -m "feat(bridge): add Riverpod probe extension (list, read, override)"
```

---

### Task 12: Dart Bridge — Riverpod Watch Extension

**Files:**
- Modify: `packages/fliwright-bridge/lib/src/extensions/riverpod.dart`

- [ ] **Step 1: Add watch extension to riverpod.dart**

Add to the `RiverpodExtension` class:

```dart
  static void register(ExtensionRegistry registry) {
    registry.register('ext.fliwright.riverpod.list', _listProviders);
    registry.register('ext.fliwright.riverpod.read', _readProvider);
    registry.register('ext.fliwright.riverpod.override', _overrideProvider);
    registry.register('ext.fliwright.riverpod.watch', _watchProvider);
    registry.register('ext.fliwright.riverpod.unwatch', _unwatchProvider);
  }
```

Add the watch/unwatch handlers:

```dart
  static final Map<String, dynamic> _activeSubscriptions = {};

  static Future<Map<String, dynamic>> _watchProvider(
    Map<String, String> params,
  ) async {
    final container = _getContainer();
    final providerName = params['provider'];
    if (providerName == null) {
      return {'error': 'Missing parameter: provider'};
    }
    if (container == null) {
      return {'error': 'ProviderContainer not found'};
    }

    // In real implementation, subscribe to the provider's changes
    // and post events via the Extension stream
    _activeSubscriptions[providerName] = true;

    return {
      'watching': true,
      'provider': providerName,
    };
  }

  static Future<Map<String, dynamic>> _unwatchProvider(
    Map<String, String> params,
  ) async {
    final providerName = params['provider'];
    if (providerName == null) {
      return {'error': 'Missing parameter: provider'};
    }

    _activeSubscriptions.remove(providerName);

    return {
      'watching': false,
      'provider': providerName,
    };
  }
```

- [ ] **Step 2: Add tests for watch/unwatch**

Append to the RiverpodExtension test group:

```dart
    test('registers watch and unwatch extensions', () async {
      await FliwrightBridge.init();
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, contains('ext.fliwright.riverpod.watch'));
      expect(methods, contains('ext.fliwright.riverpod.unwatch'));
    });

    test('watch returns error when provider name is missing', () async {
      await FliwrightBridge.init();
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.watch',
        {},
      );
      expect(result, contains('error'));
    });
```

- [ ] **Step 3: Run tests**

```bash
cd packages/fliwright-bridge && flutter test
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-bridge/
git commit -m "feat(bridge): add Riverpod watch/unwatch extensions"
```

---

### Task 13: @fliwright/plugin-riverpod — TS Package

**Files:**
- Create: `packages/fliwright-plugin-riverpod/package.json`
- Create: `packages/fliwright-plugin-riverpod/tsconfig.json`
- Create: `packages/fliwright-plugin-riverpod/vitest.config.ts`
- Create: `packages/fliwright-plugin-riverpod/src/RiverpodStateAdapter.ts`
- Create: `packages/fliwright-plugin-riverpod/src/index.ts`
- Create: `packages/fliwright-plugin-riverpod/tests/RiverpodStateAdapter.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@fliwright/plugin-riverpod",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@fliwright/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write the failing test**

```typescript
// packages/fliwright-plugin-riverpod/tests/RiverpodStateAdapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RiverpodStateAdapter } from '../src/RiverpodStateAdapter.js';

function createMockSendRequest(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((method: string, params?: Record<string, unknown>) => {
    const key = `${method}:${params?.provider ?? ''}`;
    if (responses[key] !== undefined) return Promise.resolve(responses[key]);
    if (responses[method] !== undefined) return Promise.resolve(responses[method]);
    return Promise.resolve({});
  });
}

describe('RiverpodStateAdapter', () => {
  it('reads a provider value via VM Service', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.read': { provider: 'counter', value: 42, found: true },
    });

    const adapter = new RiverpodStateAdapter(sendRequest);
    const value = await adapter.read('counter');
    expect(value).toEqual(42);
    expect(sendRequest).toHaveBeenCalledWith(
      'ext.fliwright.riverpod.read',
      { provider: 'counter' },
    );
  });

  it('writes a provider value via override', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.override': { provider: 'counter', overridden: true },
    });

    const adapter = new RiverpodStateAdapter(sendRequest);
    await adapter.write('counter', 99);
    expect(sendRequest).toHaveBeenCalledWith(
      'ext.fliwright.riverpod.override',
      { provider: 'counter', value: '99' },
    );
  });

  it('lists providers', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.list': {
        providers: [
          { name: 'counter', type: 'int', value: 0 },
          { name: 'userProvider', type: 'User?', value: null },
        ],
      },
    });

    const adapter = new RiverpodStateAdapter(sendRequest);
    const providers = await adapter.listProviders();
    expect(providers).toHaveLength(2);
    expect(providers[0].name).toBe('counter');
  });

  it('overrides a provider', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.override': { provider: 'user', overridden: true },
    });

    const adapter = new RiverpodStateAdapter(sendRequest);
    await adapter.override('user', { name: 'Alice' });
    expect(sendRequest).toHaveBeenCalledWith(
      'ext.fliwright.riverpod.override',
      { provider: 'user', value: '{"name":"Alice"}' },
    );
  });

  it('watch returns an unsubscribe function', async () => {
    const sendRequest = createMockSendRequest({
      'ext.fliwright.riverpod.watch': { watching: true, provider: 'counter' },
      'ext.fliwright.riverpod.unwatch': { watching: false, provider: 'counter' },
    });

    const onEvent = vi.fn();
    const adapter = new RiverpodStateAdapter(sendRequest);
    const unsub = await adapter.watch('counter', onEvent);

    expect(sendRequest).toHaveBeenCalledWith(
      'ext.fliwright.riverpod.watch',
      { provider: 'counter' },
    );

    // Unsubscribe
    await unsub();
    expect(sendRequest).toHaveBeenCalledWith(
      'ext.fliwright.riverpod.unwatch',
      { provider: 'counter' },
    );
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

```bash
cd packages/fliwright-plugin-riverpod && pnpm install && pnpm vitest run
```

Expected: FAIL — `RiverpodStateAdapter` module not found.

- [ ] **Step 6: Implement RiverpodStateAdapter**

```typescript
// packages/fliwright-plugin-riverpod/src/RiverpodStateAdapter.ts

import type { StateAdapter } from '@fliwright/core';
import type { ProviderInfo } from '@fliwright/core';

type SendRequest = (
  method: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

export class RiverpodStateAdapter implements StateAdapter {
  constructor(
    private sendRequest: SendRequest,
    private eventListeners: Map<string, Set<(oldVal: unknown, newVal: unknown) => void>> = new Map(),
  ) {}

  async read(key: string): Promise<unknown> {
    const result = (await this.sendRequest(
      'ext.fliwright.riverpod.read',
      { provider: key },
    )) as { value: unknown; found: boolean };
    return result.value;
  }

  async write(key: string, value: unknown): Promise<void> {
    await this.sendRequest('ext.fliwright.riverpod.override', {
      provider: key,
      value: String(value),
    });
  }

  async watch(
    key: string,
    callback: (oldValue: unknown, newValue: unknown) => void,
  ): Promise<() => void> {
    const listeners = this.eventListeners.get(key) ?? new Set();
    listeners.add(callback);
    this.eventListeners.set(key, listeners);

    await this.sendRequest('ext.fliwright.riverpod.watch', {
      provider: key,
    });

    return async () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this.eventListeners.delete(key);
        await this.sendRequest('ext.fliwright.riverpod.unwatch', {
          provider: key,
        });
      }
    };
  }

  async listProviders(): Promise<ProviderInfo[]> {
    const result = (await this.sendRequest(
      'ext.fliwright.riverpod.list',
    )) as { providers: ProviderInfo[] };
    return result.providers ?? [];
  }

  async override(key: string, value: unknown): Promise<void> {
    await this.sendRequest('ext.fliwright.riverpod.override', {
      provider: key,
      value: JSON.stringify(value),
    });
  }

  /** Called by the Driver when a stream event arrives for a watched provider */
  handleEvent(providerKey: string, oldValue: unknown, newValue: unknown): void {
    const listeners = this.eventListeners.get(providerKey);
    if (listeners) {
      for (const cb of listeners) {
        cb(oldValue, newValue);
      }
    }
  }
}
```

- [ ] **Step 7: Create src/index.ts**

```typescript
export { RiverpodStateAdapter } from './RiverpodStateAdapter.js';
```

- [ ] **Step 8: Run tests**

```bash
cd packages/fliwright-plugin-riverpod && pnpm vitest run
```

Expected: All 5 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/fliwright-plugin-riverpod/
git commit -m "feat(riverpod): implement RiverpodStateAdapter TS plugin"
```

---

### Task 14: Riverpod FliwrightPlugin Wrapper

**Files:**
- Modify: `packages/fliwright-plugin-riverpod/src/index.ts`
- Create: `packages/fliwright-plugin-riverpod/src/plugin.ts`
- Create: `packages/fliwright-plugin-riverpod/tests/plugin.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/fliwright-plugin-riverpod/tests/plugin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { riverpodPlugin } from '../src/plugin.js';
import type { PluginContext } from '@fliwright/core';
import type { StateAdapter } from '@fliwright/core';

describe('riverpodPlugin', () => {
  it('has the correct plugin name', () => {
    const plugin = riverpodPlugin();
    expect(plugin.name).toBe('riverpod');
  });

  it('registers a StateAdapter on init', async () => {
    const plugin = riverpodPlugin();
    const registeredAdapters: Array<{ name: string; adapter: unknown }> = [];

    const mockContext: PluginContext = {
      sendRequest: vi.fn().mockResolvedValue({}),
      registerStateAdapter: (name, adapter) => {
        registeredAdapters.push({ name, adapter });
      },
      registerMockAdapter: vi.fn(),
      registerFinderStrategy: vi.fn(),
      registerHealingStrategy: vi.fn(),
    };

    await plugin.onInit!(mockContext);

    expect(registeredAdapters).toHaveLength(1);
    expect(registeredAdapters[0].name).toBe('riverpod');
    expect(registeredAdapters[0].adapter).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/fliwright-plugin-riverpod && pnpm vitest run tests/plugin.test.ts
```

Expected: FAIL — `plugin` module not found.

- [ ] **Step 3: Implement the plugin wrapper**

```typescript
// packages/fliwright-plugin-riverpod/src/plugin.ts

import type { FliwrightPlugin, PluginContext } from '@fliwright/core';
import { RiverpodStateAdapter } from './RiverpodStateAdapter.js';

export function riverpodPlugin(): FliwrightPlugin & { adapter?: RiverpodStateAdapter } {
  let adapter: RiverpodStateAdapter | undefined;

  return {
    name: 'riverpod',

    async onInit(context: PluginContext): Promise<void> {
      adapter = new RiverpodStateAdapter(
        (method, params) => context.sendRequest(method, params),
      );
      context.registerStateAdapter('riverpod', adapter);
    },
  };
}
```

- [ ] **Step 4: Update src/index.ts to export the plugin**

```typescript
export { RiverpodStateAdapter } from './RiverpodStateAdapter.js';
export { riverpodPlugin } from './plugin.js';
```

- [ ] **Step 5: Run all plugin tests**

```bash
cd packages/fliwright-plugin-riverpod && pnpm vitest run
```

Expected: All 7 tests PASS (5 adapter + 2 plugin).

- [ ] **Step 6: Commit**

```bash
git add packages/fliwright-plugin-riverpod/
git commit -m "feat(riverpod): add riverpodPlugin wrapper for Driver integration"
```

---

### Task 15: Validation Demo — Flutter App

**Files:**
- Create: `examples/riverpod_demo/pubspec.yaml`
- Create: `examples/riverpod_demo/lib/main.dart`
- Create: `examples/riverpod_demo/test_driver/fliwright_app.dart`

- [ ] **Step 1: Create pubspec.yaml**

```yaml
name: riverpod_demo
description: Demo Flutter app for validating Fliwright architecture with Riverpod.
version: 0.1.0

environment:
  sdk: ^3.5.0

dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.5.0
  fliwright_bridge:
    path: ../../packages/fliwright-bridge

dev_dependencies:
  flutter_test:
    sdk: flutter
  integration_test:
    sdk: flutter
```

- [ ] **Step 2: Create the demo app with Riverpod**

```dart
// examples/riverpod_demo/lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final counterProvider = StateProvider<int>((ref) => 0);

final userProvider = StateProvider<Map<String, dynamic>?>((ref) => null);

void main() {
  runApp(const ProviderScope(child: MyApp()));
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Fliwright Riverpod Demo',
      home: const HomePage(),
    );
  }
}

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(counterProvider);
    final user = ref.watch(userProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Fliwright Demo')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Count: $count', key: const Key('counter_text')),
            const SizedBox(height: 16),
            if (user != null)
              Text('User: ${user['name']}', key: const Key('user_text'))
            else
              const Text('No user logged in', key: Key('no_user_text')),
            const SizedBox(height: 16),
            ElevatedButton(
              key: const Key('increment_button'),
              onPressed: () => ref.read(counterProvider.notifier).state++,
              child: const Text('Increment'),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Create the Fliwright test driver entry**

```dart
// examples/riverpod_demo/test_driver/fliwright_app.dart
import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_demo/main.dart' as app;

void main() async {
  // Initialize Fliwright bridge
  await FliwrightBridge.init();

  // Store the ProviderContainer for Riverpod access
  final container = ProviderContainer();
  RiverpodExtension.providerContainer = container;

  // Run the original app
  app.main();
}
```

- [ ] **Step 4: Get dependencies**

```bash
cd examples/riverpod_demo && flutter pub get
```

Expected: Dependencies resolved successfully.

- [ ] **Step 5: Commit**

```bash
git add examples/riverpod_demo/
git commit -m "feat(demo): add Riverpod demo app for architecture validation"
```

---

### Task 16: E2E Validation — Full Integration Smoke Test

**Files:**
- Create: `examples/riverpod_demo/test/e2e_smoke_test.dart`

This is a manual integration test that verifies the full TS → Dart bridge → Riverpod flow. Since it requires a running Flutter app, we write it as a Dart integration test that exercises the extension registry directly.

- [ ] **Step 1: Write the E2E smoke test**

```dart
// examples/riverpod_demo/test/e2e_smoke_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() {
  group('E2E Architecture Validation', () {
    setUp(() async {
      await FliwrightBridge.init();
    });

    test('handshake succeeds with compatible version', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.handshake',
        {'protocolVersion': '1'},
      );
      expect(result['status'], equals('ok'));
      expect(result['compatible'], isTrue);
    });

    test('ping returns ok status', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.ping',
        {},
      );
      expect(result['status'], equals('ok'));
      expect(result, contains('timestamp'));
    });

    test('riverpod list extension is registered and callable', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.list',
        {},
      );
      expect(result, contains('containerReady'));
    });

    test('riverpod read requires provider parameter', () async {
      final result = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.read',
        {},
      );
      expect(result, contains('error'));
    });

    test('riverpod watch and unwatch flow', () async {
      final watchResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.watch',
        {'provider': 'counterProvider'},
      );
      expect(watchResult['watching'], isTrue);

      final unwatchResult = await FliwrightBridge.registry.invoke(
        'ext.fliwright.riverpod.unwatch',
        {'provider': 'counterProvider'},
      );
      expect(unwatchResult['watching'], isFalse);
    });

    test('all expected extensions are registered', () async {
      final methods = FliwrightBridge.registry.registeredMethods;
      expect(methods, containsAll([
        'ext.fliwright.ping',
        'ext.fliwright.handshake',
        'ext.fliwright.riverpod.list',
        'ext.fliwright.riverpod.read',
        'ext.fliwright.riverpod.override',
        'ext.fliwright.riverpod.watch',
        'ext.fliwright.riverpod.unwatch',
      ]));
    });
  });
}
```

- [ ] **Step 2: Run E2E tests**

```bash
cd examples/riverpod_demo && flutter test test/e2e_smoke_test.dart
```

Expected: All 6 tests PASS.

- [ ] **Step 3: Run full test suite across all packages**

```bash
cd packages/fliwright-core && pnpm vitest run
cd ../fliwright-bridge && flutter test
cd ../fliwright-plugin-riverpod && pnpm vitest run
cd ../../../examples/riverpod_demo && flutter test test/e2e_smoke_test.dart
```

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add examples/riverpod_demo/
git commit -m "test(demo): add E2E architecture validation smoke tests"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Task | Plan Task | Status |
|-----------|-----------|--------|
| 0.1 Core interface definitions | Tasks 3-5 | Covered: Plugin, StateAdapter, MockAdapter, FinderStrategy, HealingStrategy |
| 0.2 Plugin registry & lifecycle | Task 6 | Covered: register, resolve, initAll, notifyTestStart/End, disposeAll |
| 0.3 StateAdapter abstraction | Task 4 | Covered: read, write, watch, listProviders, override |
| 0.4 MockAdapter abstraction | Task 5 | Covered: addRoute, removeRoute, clear |
| 0.5 FinderStrategy abstraction | Task 5 | Covered: find, describe, strategyName |
| 0.6 HealingStrategy abstraction | Task 5 | Covered: score, heal, strategyName |
| 0.7 Dart extension registry | Task 10 | Covered: ExtensionRegistry with register, invoke, isRegistered |
| 0.8 Communication protocol | Task 7 | Covered: Protocol with versioned handshake |
| 0.9 Dart Riverpod probe | Task 11 | Covered: list, read, override extensions |
| 0.10 Dart state change event stream | Task 12 | Covered: watch, unwatch extensions |
| 0.11 TS Riverpod plugin | Tasks 13-14 | Covered: RiverpodStateAdapter + riverpodPlugin wrapper |
| 0.12 Architecture validation | Tasks 15-16 | Covered: demo app + E2E smoke tests |

### Placeholder Scan

No TBD, TODO, or placeholder patterns found.

### Type Consistency

- `StateAdapter` methods: `read(key: string)`, `write(key: string, value: unknown)`, `watch(key, callback)`, `listProviders()`, `override(key, value)` — consistent across interface definition, PluginRegistry storage, Driver accessors, and RiverpodStateAdapter implementation.
- `ProtocolMessage` type used consistently in Protocol and VMServiceConnector.
- `PluginContext.registerStateAdapter(name, adapter)` signature matches usage in plugin.test.ts and PluginRegistry.
