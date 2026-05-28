# Fliwright MVP + V1.0 Implementation Design

**Date**: 2026-05-28
**Status**: Approved
**Scope**: MVP + V1.0 (per PRD sections 9.1 & 9.2)

---

## Overview

Fliwright is an AI-native, zero-intrusion end-to-end testing framework for Flutter apps. This design covers the MVP (core SDK + Dart bridge + HTTP Mock) and V1.0 (recorder + form helper + self-healing + MCP Server + VS Code extension), decomposed into 9 vertical slices.

**Strategy**: Vertical slicing — each slice delivers a working end-to-end capability that can be demoed and tested independently.

**Architecture**: TypeScript SDK (`@fliwright/core`) + Dart bridge (`fliwright_bridge`) communicating via Dart VM Service WebSocket. Plugin-based extensibility for state management, mock, finder, and healing strategies.

---

## Slice 0: Extensible Architecture Design (17 days)

**Goal**: Design a plugin-based core architecture where every capability is extensible without modifying core code. Validate with a Riverpod state management proof-of-concept.

### Tasks

| # | Task | Description | Est. |
|---|------|-------------|------|
| 0.1 | Core interface definitions | Define `FliwrightPlugin`, `StateAdapter`, `MockAdapter`, `FinderStrategy`, `HealingStrategy` abstract interfaces | 2d |
| 0.2 | Plugin registry & lifecycle | `PluginRegistry`: `register()`, `resolve()`, dependency declaration, lifecycle hooks (`onInit`, `onTestStart`, `onTestEnd`, `onDispose`) | 2d |
| 0.3 | StateAdapter abstraction | Interface: `read(key)`, `write(key, value)`, `watch(key, callback)`, `listProviders()`, `override(key, value)` | 1d |
| 0.4 | MockAdapter abstraction | Interface: `addRoute()`, `removeRoute()`, `clear()`. Built-in HttpServer implementation with custom interceptor slots | 1d |
| 0.5 | FinderStrategy abstraction | Interface: `find()`, `describe()`. Built-in text/key/type strategies, reserved slot for semantic vector strategy | 1d |
| 0.6 | HealingStrategy abstraction | Interface: `score()`, `heal()`. Built-in multi-dimensional feature matching, reserved slot for LLM-assisted strategy | 1d |
| 0.7 | Dart extension registry | Dart-side `ExtensionRegistry` for dynamic `ext.fliwright.*` extension registration with plugin-based injection | 1d |
| 0.8 | Communication protocol versioning | Define TS ↔ Dart JSON Schema protocol with version negotiation for forward compatibility | 1d |
| 0.9 | Dart: Riverpod probe | `ext.fliwright.riverpod.*` — read/override/list via `ProviderContainer` reflection | 2d |
| 0.10 | Dart: State change event stream | `ext.fliwright.riverpod.watch` — monitor Provider changes, push via VM Service event channel | 1d |
| 0.11 | TS SDK: Riverpod plugin | `@fliwright/plugin-riverpod` implementing `StateAdapter`, wrapping read/write/watch/override/list | 2d |
| 0.12 | Architecture validation demo | Create a Riverpod-based Flutter app, verify read, watch, override Provider end-to-end | 2d |

### Architecture

```
@fliwright/core
├── interfaces/          # Pure interface definitions
│   ├── Plugin.ts        # FliwrightPlugin lifecycle
│   ├── StateAdapter.ts  # State management abstraction
│   ├── MockAdapter.ts   # Mock abstraction
│   ├── FinderStrategy.ts
│   └── HealingStrategy.ts
├── PluginRegistry.ts    # Plugin registration & dependency resolution
├── Driver.ts            # Core Driver, resolves capabilities via Registry
└── Protocol.ts          # TS ↔ Dart communication protocol

@fliwright/plugin-riverpod   # Independent package
├── RiverpodStateAdapter.ts  # Implements StateAdapter
└── index.ts

fliwright_bridge (Dart)
├── extension_registry.dart  # Dynamic extension registration
├── extensions/
│   ├── click.dart
│   ├── gesture.dart
│   ├── inspect.dart
│   └── riverpod.dart
└── bridge.dart
```

### Riverpod State Management API

```typescript
const riverpod = driver.plugins.getStateAdapter('riverpod');

// List all providers
const providers = await riverpod.listProviders();
// [{ name: 'userProvider', type: 'User?', value: null }, ...]

// Read current value
const user = await riverpod.read('userProvider');

// Override value (skip login flow)
await riverpod.override('userProvider', { name: 'Alice', role: 'admin' });

// Watch state changes
await riverpod.watch('cartProvider', (oldVal, newVal) => {
  console.log('Cart changed:', oldVal, '→', newVal);
});
```

---

## Slice 1: Minimal Loop — Remote Click (15 days)

**Goal**: Execute a click operation on a Flutter device via TypeScript code.

| # | Task | Description | Est. |
|---|------|-------------|------|
| 1.1 | Project scaffolding | Monorepo (`packages/fliwright_bridge` Dart + `packages/fliwright-core` TS), melos, pnpm workspace, pub workspace | 1d |
| 1.2 | Dart: VM Service extension registration | `fliwright_bridge` package, `FliwrightBridge.init()` registers `ext.fliwright.*` | 2d |
| 1.3 | Dart: Click extension | `ext.fliwright.click` — receive coordinates, simulate tap via `GestureBinding` | 1d |
| 1.4 | Dart: Widget tree query | `ext.fliwright.inspect` — wrap `WidgetInspectorService`, return matched widget coordinates & metadata | 2d |
| 1.5 | Compile-time injection generator | Auto-generate `test_driver/fliwright_app.dart` wrapping original `main.dart` | 1d |
| 1.6 | TS: VM Service connector | WebSocket connection to Dart VM Service, service discovery (from `flutter run` logs or passed URI) | 2d |
| 1.7 | TS: FliwrightDriver & Page | `new FliwrightDriver()` → `driver.connect()` → `driver.page` | 2d |
| 1.8 | TS: Locator basics | `page.locator('text=Login')` — text selector, locate via Widget tree query and click | 2d |
| 1.9 | E2E smoke test | Create sample Flutter app, write TS test script, verify click end-to-end | 2d |

---

## Slice 2: Assertion Loop — Complete Test Cases (12 days)

**Goal**: Write complete end-to-end test cases with assertions and auto-wait.

| # | Task | Description | Est. |
|---|------|-------------|------|
| 2.1 | Dart: Type extension | `ext.fliwright.type` — simulate keyboard input via system channel, trigger form validation | 1d |
| 2.2 | Dart: Scroll extension | `ext.fliwright.scrollIntoView` — scroll target widget into viewport | 1d |
| 2.3 | Dart: Complex gestures | `ext.fliwright.gesture` — long press, drag, pinch | 2d |
| 2.4 | TS: Assertion engine | `expect(locator).toBeVisible()` / `hasText()` / `toBeEnabled()`, built-in 5000ms polling retry | 3d |
| 2.5 | TS: Extended selectors | Key selector (`byKey`), type selector (`byType`), composite selectors | 1d |
| 2.6 | TS: Failure screenshot & context | Auto-screenshot on assertion failure, collect Widget tree snapshot, source line numbers | 2d |
| 2.7 | TS: Test runner integration | Jest/Vitest `test()` integration, `beforeEach/afterEach` hooks for device lifecycle | 2d |

---

## Slice 3: Mock Loop — HTTP Interception & State Injection (11 days)

**Goal**: Declare HTTP mocks and state injection to run tests independent of backend.

| # | Task | Description | Est. |
|---|------|-------------|------|
| 3.1 | Dart: Built-in HTTP Mock server | Start HttpServer in `FliwrightBridge`, listen on port, receive route rules | 2d |
| 3.2 | Dart: Request interception | Redirect Flutter `HttpClient` requests to Mock server, match rules, return preset responses | 2d |
| 3.3 | TS: Mock Manager | `driver.mock.route('/api/login', { body: { token: 'xxx' } })` declarative route config | 2d |
| 3.4 | TS: Mock rule sync | Pass Mock rules from TS to Dart Mock server via VM Service | 1d |
| 3.5 | Dart: State injection extension | `ext.fliwright.updateState` — modify Provider/Bloc/Riverpod state via reflection | 2d |
| 3.6 | TS: State injection API | `driver.page.setState('authProvider', { isLoggedIn: true })` high-level wrapper | 1d |
| 3.7 | Mock integration test | Create API-dependent Flutter app, verify Mock interception and state injection end-to-end | 1d |

---

## Slice 4: Self-Healing Loop — Auto-Fix on Failure (13 days)

**Goal**: When selectors break due to UI changes, automatically find alternative widgets and continue execution.

| # | Task | Description | Est. |
|---|------|-------------|------|
| 4.1 | Dart: Widget metadata snapshot | `ext.fliwright.snapshot` — collect multi-dimensional features (type, parent structure, adjacent text, screen position, callback names) | 2d |
| 4.2 | TS: Metadata storage | Local file storage for first-success metadata snapshots, keyed by test name and selector | 1d |
| 4.3 | TS: Fuzzy matching algorithm | Position similarity, context similarity, code binding, semantic vector weighted scoring | 3d |
| 4.4 | TS: Healing redirect | Auto-redirect operation when match score exceeds threshold (default 0.85) | 2d |
| 4.5 | TS: Healing report generation | Record original selector → matched widget → confidence → suggested new selector as structured JSON | 1d |
| 4.6 | TS: Assertion-healing integration | Trigger self-healing on assertion failure; if healed, assertion passes with maintenance report | 2d |
| 4.7 | Self-healing integration test | Simulate UI changes (text change, hierarchy change, position shift), verify healing accuracy | 2d |

---

## Slice 5: Recording Loop — Codegen (13 days)

**Goal**: Auto-generate test scripts from user interactions on the device.

| # | Task | Description | Est. |
|---|------|-------------|------|
| 5.1 | Dart: Pointer event listener | `ext.fliwright.startRecording` — intercept touch events via `PointerRouter`, report coordinates & timestamps | 2d |
| 5.2 | Dart: Event-to-Widget reverse lookup | Hit-test Widget tree by coordinates, extract semantic features (text, Key, type) | 3d |
| 5.3 | Dart: Recording data stream | Push structured operation sequence to TS via VM Service event channel | 1d |
| 5.4 | TS: Recorder controller | `driver.record.start()` / `stop()`, receive and buffer operation stream | 1d |
| 5.5 | TS: Operation-to-code generation | Convert operation sequence to Fliwright API calls (smart selector selection) | 3d |
| 5.6 | TS: Code formatting & output | Format generated code, add imports, output as `.test.ts` file | 1d |
| 5.7 | Recording E2E test | Record a full login flow, verify generated test runs successfully | 2d |

---

## Slice 6: Form Helper Loop (13 days)

**Goal**: Auto-identify form field semantics, generate compliant fake data, and fill forms in one call.

| # | Task | Description | Est. |
|---|------|-------------|------|
| 6.1 | Dart: Form field extraction | `ext.fliwright.extractForm` — traverse Widget tree, identify TextField/TextFormField, extract hintText, label, keyboardType, maxLength | 2d |
| 6.2 | TS: Semantic inference engine | Infer field type (phone, email, ID card, address) from keyboardType and hintText regex | 2d |
| 6.3 | TS: Faker data generator | Locale-aware compliant data generation (phone formats, ID checksum, email) | 2d |
| 6.4 | TS: Skill registry | Register custom strategies (PRESET_SKILL, REGEXP_MOCK, LLM_GENERATE), dynamic extension | 2d |
| 6.5 | TS: JSON rule loader | Load AI-generated JSON config defining field match rules and generation strategies | 1d |
| 6.6 | TS: Form fill executor | `page.formHelper.fill()` — parse form → generate data → inject via type extension per field | 2d |
| 6.7 | Form helper integration test | Create diverse forms (registration, payment, address), verify semantic inference and fill accuracy | 2d |

---

## Slice 7: MCP Loop — AI Agent Integration (10 days)

**Goal**: Expose core capabilities as MCP Server for Cursor/Claude Code to run tests, get structured feedback, and auto-fix.

| # | Task | Description | Est. |
|---|------|-------------|------|
| 7.1 | MCP Server scaffold | Build on `@modelcontextprotocol/sdk`, stdio/SSE transport | 1d |
| 7.2 | MCP Tool: run test | `fliwright_run` — execute tests, return pass/fail status | 1d |
| 7.3 | MCP Tool: get failure context | `fliwright_get_failure` — return screenshot URL, Widget tree diff, source line, healing suggestion as structured JSON | 2d |
| 7.4 | MCP Tool: generate test | `fliwright_generate_test` — accept natural language or Flutter source, output test script | 2d |
| 7.5 | MCP Tool: mock config | `fliwright_mock` — declare API mock rules | 1d |
| 7.6 | MCP Resource: test report | Expose latest run results as MCP Resource for AI Agent to read | 1d |
| 7.7 | MCP integration test | Call MCP Server from Claude Code / Cursor, verify end-to-end AI loop | 2d |

---

## Slice 8: CLI + VS Code Extension (16 days)

### 8A: CLI (7 days)

| # | Task | Description | Est. |
|---|------|-------------|------|
| 8A.1 | CLI scaffold | `commander.js`-based CLI, sub-command registration framework | 1d |
| 8A.2 | `fliwright run` | Run test cases, output results to terminal, `--watch` mode | 2d |
| 8A.3 | `fliwright record` | Start recording mode, connect to device, display captured operations in real-time | 2d |
| 8A.4 | `fliwright mock` | Manage mock rules (list, add, remove) | 1d |
| 8A.5 | `fliwright init` | Project init — generate `fliwright.config.ts`, inject `fliwright_app.dart` | 1d |

### 8B: VS Code Extension (9 days)

| # | Task | Description | Est. |
|---|------|-------------|------|
| 8B.1 | Extension scaffold | Yeoman-generated VS Code extension, sidebar test panel UI | 1d |
| 8B.2 | Test panel | Sidebar tree view of test cases, click to run, show pass/fail status | 2d |
| 8B.3 | Screen recording & Trace Viewer | Webview for live device screen, replay operation trace on failure | 3d |
| 8B.4 | Sandbox control panel | One-click start/stop Mock server, manage state injection | 1d |
| 8B.5 | Healing report display | Inline healing report in editor, one-click accept selector update suggestions | 2d |

---

## Timeline Summary

| Slice | Content | Days | Cumulative |
|-------|---------|------|------------|
| 0 | Extensible Architecture | 17d | 17d |
| 1 | Minimal Loop | 15d | 32d |
| 2 | Assertion Loop | 12d | 44d |
| 3 | Mock Loop | 11d | 55d |
| 4 | Self-Healing Loop | 13d | 68d |
| 5 | Recording Loop | 13d | 81d |
| 6 | Form Helper Loop | 13d | 94d |
| 7 | MCP Loop | 10d | 104d |
| 8 | CLI + VS Code Extension | 16d | 120d |

**Total: ~120 working days (~6 months)**

### Key Milestones

- **Week 3**: Slice 0 — Extensible architecture ready, Riverpod state management validated
- **Week 6**: Slice 1 — Remote click on real device
- **Week 9**: Slice 2 — Complete test cases with assertions
- **Week 11**: Slice 3 — Mock interface for independent testing (**MVP delivery**)
- **Week 14**: Slice 4 — Self-healing engine online
- **Week 16**: Slice 5 — Recording/codegen online
- **Week 19**: Slice 6 — Form helper online
- **Week 21**: Slice 7 — MCP loop, AI Agent ready
- **Week 24**: Slice 8 — CLI + VS Code extension (**V1.0 delivery**)

### Dependencies

- Strict linear ordering: each slice depends on the previous slice's output
- Slice 8A (CLI) and 8B (VS Code) can be developed in parallel
- Slice 0 (Architecture) must complete before any implementation slice begins
