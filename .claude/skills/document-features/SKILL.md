---
name: document-features
description: "Summarize implemented features from source code and generate indexed markdown documentation under docs/features/ for AI agent consumption. Use this skill whenever the user asks to document features, generate feature docs, create API documentation, summarize what's implemented, index features, or wants an overview of the project's capabilities — even if they don't use the exact phrase 'document features'."
---

# Document Features

Generate structured, AI-agent-consumable documentation for every implemented feature in this project. The output lives in `docs/features/` with an `index.md` routing table that lets any AI agent quickly navigate the codebase's capabilities.

## Why This Exists

AI agents working on this codebase need to understand what's implemented without reading every source file. These docs act as a compressed map of the project — accurate, structured, and indexed for fast lookup. They are NOT for human end-users; they are for the next Claude session, the MCP agent, or any AI tool that needs to answer "can this project do X?"

## Output Directory

All generated files go to `docs/features/`. On each run, **clear the entire directory first** and regenerate everything — this ensures consistency.

The output has three layers: **package-level summaries**, **per-class detailed docs in sub-directories**, and **cross-cutting pipeline docs**.

```
docs/features/
├── index.md                          # Routing table (start here)
├── core/                             # @fliwright/core — per-class sub-directory
│   ├── README.md                     # Package overview + links to each class doc
│   ├── FliwrightDriver.md            # Detailed doc for FliwrightDriver
│   ├── Page.md                       # Detailed doc for Page
│   ├── Locator.md                    # Detailed doc for Locator
│   ├── Assertion.md                  # Detailed doc for Assertion + createExpect
│   ├── MockManager.md                # Detailed doc for MockManager
│   ├── SelfHealingEngine.md          # Detailed doc for SelfHealingEngine
│   ├── SnapshotStore.md              # Detailed doc for SnapshotStore
│   ├── RecorderController.md         # Detailed doc for RecorderController
│   ├── CodeGenerator.md              # Detailed doc for CodeGenerator
│   ├── DartCodeGenerator.md          # Detailed doc for DartCodeGenerator
│   ├── AssertionSuggester.md         # Detailed doc for AssertionSuggester
│   ├── FormHelper.md                 # Detailed doc for FormHelper
│   ├── SemanticInferrer.md           # Detailed doc for SemanticInferrer
│   ├── FakerGenerator.md             # Detailed doc for FakerGenerator
│   ├── SkillRegistry.md              # Detailed doc for SkillRegistry
│   ├── JsonRuleLoader.md             # Detailed doc for JsonRuleLoader
│   ├── SelectorResolver.md           # Detailed doc for SelectorResolver
│   ├── PluginRegistry.md             # Detailed doc for PluginRegistry
│   ├── Protocol.md                   # Detailed doc for Protocol
│   ├── VMServiceConnector.md         # Detailed doc for VMServiceConnector
│   ├── EventAggregator.md            # Detailed doc for EventAggregator
│   ├── FailureCollector.md           # Detailed doc for FailureCollector
│   ├── MultiDimensionalHealingStrategy.md  # Detailed doc for strategy
│   └── types.md                      # All exported types and interfaces
├── mcp/                              # @fliwright/mcp
│   ├── README.md                     # Package overview
│   ├── fliwright-run.md              # Detailed doc for fliwright_run tool
│   ├── fliwright-get-failure.md      # Detailed doc for fliwright_get_failure tool
│   ├── fliwright-generate-test.md    # Detailed doc for fliwright_generate_test tool
│   └── test-report.md               # Detailed doc for test_report resource
├── vitest/                           # @fliwright/vitest
│   ├── README.md                     # Package overview
│   ├── test.md                       # Detailed doc for test() fixture
│   └── expect.md                     # Detailed doc for expect() assertion
├── cli/                              # @fliwright/cli
│   ├── README.md                     # Package overview
│   ├── run.md                        # Detailed doc for run command
│   ├── init.md                       # Detailed doc for init command
│   ├── doctor.md                     # Detailed doc for doctor command
│   └── record.md                     # Detailed doc for record command
├── plugin-riverpod/                  # @fliwright/plugin-riverpod
│   ├── README.md                     # Package overview
│   └── RiverpodStateAdapter.md       # Detailed doc for StateAdapter
├── bridge/                           # fliwright-bridge (Dart)
│   ├── README.md                     # Package overview
│   ├── GestureExtension.md           # Detailed doc for gesture extension
│   ├── InspectExtension.md           # Detailed doc for inspect extension
│   ├── TypeExtension.md              # Detailed doc for type extension
│   ├── ScrollExtension.md            # Detailed doc for scroll extension
│   ├── SnapshotExtension.md          # Detailed doc for snapshot extension
│   ├── RecordingExtension.md         # Detailed doc for recording extension
│   ├── FormExtractExtension.md       # Detailed doc for form extract extension
│   ├── RiverpodExtension.md          # Detailed doc for riverpod extension
│   ├── MockServerExtension.md        # Detailed doc for mock server extension
│   └── HttpOverrides.md              # Detailed doc for HTTP overrides
├── self-healing-pipeline.md          # Cross-cutting: self-healing
├── recording-pipeline.md             # Cross-cutting: recording & codegen
├── form-filling-pipeline.md          # Cross-cutting: form auto-fill
└── mcp-integration.md                # Cross-cutting: MCP agent integration
```

## Workflow

Follow these steps in order. Each step builds on the previous one.

### Step 1: Clear and scan

Delete everything in `docs/features/` (create the directory if it doesn't exist), then read these files to understand the monorepo layout:

- `packages/*/package.json` — package names, versions, dependencies
- `packages/*/src/index.ts` — public API surface for each TypeScript package
- `packages/fliwright-bridge/lib/fliwright_bridge.dart` — Dart bridge exports
- `packages/fliwright-bridge/lib/src/bridge.dart` — registered Dart extensions
- `packages/fliwright-mcp/src/server.ts` — MCP tool registrations

### Step 2: Extract feature inventory

For each package, read the source files listed in its `index.ts` (or `fliwright_bridge.dart`). Extract:

- **Classes**: name, constructor signature, all public methods with parameter names and return types
- **Functions**: name, parameter names/types, return type
- **Types/Interfaces**: field names and types
- **For MCP**: tool names, input schemas, descriptions, resource URIs
- **For CLI**: command names, options, descriptions
- **For bridge**: extension names registered via `_registry.register()`

Use the actual source code as the single source of truth. Do NOT document features from PRD or design specs that don't exist in code yet.

### Step 3: Map cross-cutting pipelines

Trace these pipelines through the codebase by following import chains:

| Pipeline | Trace path |
|---|---|
| Self-healing | `Assertion.ts` → `SelfHealingEngine.ts` → `SnapshotStore.ts` → `strategies/MultiDimensionalHealingStrategy.ts` → `bridge/snapshot.dart` |
| Recording & codegen | `RecorderController.ts` → `EventAggregator.ts` → `CodeGenerator.ts` + `DartCodeGenerator.ts` → `AssertionSuggester.ts` → `bridge/recording.dart` |
| Form auto-fill | `FormHelper.ts` → `SemanticInferrer.ts` → `FakerGenerator.ts` → `SkillRegistry.ts` → `JsonRuleLoader.ts` → `SelectorResolver.ts` → `bridge/form_extract.dart` |
| MCP integration | `vitest/index.ts` → `mcp/server.ts` → `mcp/tools/*.ts` → `mcp/resources/testReport.ts` |

### Step 4: Generate per-package sub-directories with per-class docs

For each package, create a sub-directory under `docs/features/` with a `README.md` package overview and one detailed markdown file per exported class, function group, or utility module.

#### 4a. Package README

Write `docs/features/<package-dir>/README.md` as the package overview:

```markdown
---
package: "@fliwright/<name>"
version: "<from package.json>"
layer: <core | integration | transport | plugin>
status: implemented
generated: "<today's date YYYY-MM-DD>"
---

# @fliwright/<name>

> One-line summary of what this package does.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `ClassName` | One-line description | [ClassName.md](./ClassName.md) |
| `AnotherClass` | One-line description | [AnotherClass.md](./AnotherClass.md) |
| `types` | All exported types and interfaces | [types.md](./types.md) |

## Dependencies

- `dependency-name` — version (from package.json)

## Usage Example

\```typescript
// A complete, runnable code snippet demonstrating the package's primary use case
\```
```

#### 4b. Per-class detailed docs

For each exported class, write `docs/features/<package-dir>/<ClassName>.md` with full detail:

```markdown
---
module: "<ClassName>"
package: "@fliwright/<name>"
source: "<relative path to source file>"
tests: "<relative path to test file>"
generated: "<today's date YYYY-MM-DD>"
---

# <ClassName>

> One-line summary of this class's responsibility and role in the system.

## Overview

2-3 sentences explaining what this class does, why it exists, and how it fits into the broader architecture. Mention which other modules depend on it or it depends on.

## Constructor

\```typescript
constructor(param1: Type1, param2?: Type2)
\```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param1` | `Type1` | Yes | What this parameter controls |
| `param2` | `Type2` | No | Default: `value`. What this does |

## Public Methods

### `methodName(param: Type): ReturnType`

Detailed description of what this method does, when to call it, and any side effects.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param` | `Type` | Yes | Description |

**Returns:** `ReturnType` — What the return value represents.

**Throws:** `ErrorType` — When and why this throws.

**Example:**

\```typescript
const result = instance.methodName('value');
\```

---

### `anotherMethod(): Promise<void>`

(Repeat the above structure for every public method.)

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `propName` | `Type` | Yes | Description |

## Related

- **Depends on:** [OtherClass](./OtherClass.md), [AnotherClass](./AnotherClass.md)
- **Used by:** [ConsumerClass](./ConsumerClass.md)
- **Test:** `tests/ClassName.test.ts`
- **Source:** `src/ClassName.ts`
```

#### 4c. Types doc

Write `docs/features/<package-dir>/types.md` for all exported types and interfaces:

```markdown
---
module: "types"
package: "@fliwright/<name>"
source: "src/types.ts"
generated: "<today's date YYYY-MM-DD>"
---

# Types & Interfaces

## Type Aliases

### `TypeName`
\```typescript
type TypeName = string | { text: string; ancestor?: TypeName };
\```
Description of when and how this type is used.

## Interfaces

### `InterfaceName`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field` | `string` | Yes | Description |

**Used by:** [ClassName](./ClassName.md)
```

#### 4d. Utility function docs

For exported standalone functions (not in a class), group related functions into a single file:

```markdown
---
module: "utility-group-name"
package: "@fliwright/<name>"
source: "src/utilityFile.ts"
generated: "<today's date YYYY-MM-DD>"
---

# Utility Functions

## `functionName(param: Type): ReturnType`

Description of what this function does.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `param` | `Type` | Description |

**Returns:** `ReturnType`

**Example:**

\```typescript
import { functionName } from '@fliwright/package';
const result = functionName('value');
\```
```

### Step 5: Generate cross-cutting pipeline docs

For each pipeline, write a markdown file using this structure:

```markdown
---
feature: "<Pipeline Name>"
packages: ["@fliwright/core", "..."]
status: implemented
agent_accessible: <true | false>
mcp_tool: "<tool name if applicable, or omit>"
generated: "<today's date>"
---

# <Pipeline Name>

> One-line summary of what this pipeline accomplishes.

## Architecture

1. **Step name** (`ClassName`): Description of what happens.
2. **Step name** (`ClassName`): Description.
3. ... continue for each stage.

## Agent Integration

How an AI agent can invoke or benefit from this feature. Include MCP tool names if applicable.

## Data Flow

\```
ASCII diagram showing the pipeline stages and data flow between components.
\```

## Key Files

- `packages/<package>/src/<file>.ts` — brief description of the file's role
```

### Step 6: Generate index.md

Write `docs/features/index.md` with exactly these five sections:

```markdown
---
purpose: "AI-agent-consumable feature index"
generated: "<today's date>"
---

# Fliwright Feature Index

> Navigation table for AI agents. Start here to understand what is implemented and where to find details.

## By Package

| Package | Description | Overview | Detailed Docs |
|---------|-------------|----------|---------------|
| `@fliwright/core` | Core SDK | [core/README.md](./core/README.md) | FliwrightDriver, Page, Locator, Assertion, MockManager, ... |
| `@fliwright/mcp` | MCP Server | [mcp/README.md](./mcp/README.md) | fliwright_run, fliwright_get_failure, ... |
| ... | ... | ... | ... |

## By Class

| Class | Package | Description | Doc |
|-------|---------|-------------|-----|
| `FliwrightDriver` | core | Main orchestrator | [core/FliwrightDriver.md](./core/FliwrightDriver.md) |
| `Page` | core | Page object model | [core/Page.md](./core/Page.md) |
| `Locator` | core | Widget locator with actions | [core/Locator.md](./core/Locator.md) |
| ... | ... | ... | ... |

## By Feature Slice

| Feature | Packages | Doc | Agent-Accessible | Status |
|---------|----------|-----|------------------|--------|
| Self-Healing Pipeline | core, bridge | [self-healing-pipeline.md](./self-healing-pipeline.md) | via MCP | Implemented |
| ... | ... | ... | ... | ... |

## MCP Tool Quick Reference

| Tool | Input | Output | Doc |
|------|-------|--------|-----|
| `fliwright_run` | testFile, vmServiceUrl?, testName?, cwd? | RunResult | [mcp/fliwright-run.md](./mcp/fliwright-run.md) |
| ... | ... | ... | ... |

## Quick Start for AI Agents

1. To **run tests**: ...
2. To **diagnose failures**: ...
3. To **generate tests**: ...
4. To **record interactions**: ...
5. To **manipulate state**: ...
```

### Step 7: Update AGENTS.md

Check if `AGENTS.md` already contains a `## Feature Documentation` section. If it does, update the links to match the new sub-directory structure. If it doesn't, **append** (do NOT overwrite) a new section at the end:

```markdown

## Feature Documentation

AI-consumable feature documentation lives in `docs/features/`. These docs summarize every implemented feature with full API signatures, type definitions, and usage examples, organized for fast lookup by AI agents.

- **Start here:** [docs/features/index.md](./docs/features/index.md) — routing table by package and by feature slice, MCP tool quick reference, agent quick-start guide
- **Per-package overviews:** [core/README.md](./docs/features/core/README.md) · [mcp/README.md](./docs/features/mcp/README.md) · [vitest/README.md](./docs/features/vitest/README.md) · [cli/README.md](./docs/features/cli/README.md) · [plugin-riverpod/README.md](./docs/features/plugin-riverpod/README.md) · [bridge/README.md](./docs/features/bridge/README.md)
- **Per-class detailed docs:** Each package sub-directory contains one `.md` per exported class/utility — e.g., [core/FliwrightDriver.md](./docs/features/core/FliwrightDriver.md), [core/Page.md](./docs/features/core/Page.md)
- **Cross-cutting pipelines:** [self-healing-pipeline.md](./docs/features/self-healing-pipeline.md) · [recording-pipeline.md](./docs/features/recording-pipeline.md) · [form-filling-pipeline.md](./docs/features/form-filling-pipeline.md) · [mcp-integration.md](./docs/features/mcp-integration.md)

Regenerate with `/document-features` when source code changes significantly.
```

Do NOT modify `CLAUDE.md` — it only references `AGENTS.md`.

---

## Per-Package Extraction Guide

This section tells you what to look for in each package. Use it as a checklist to ensure completeness.

### @fliwright/core (`docs/features/core/`)

Sub-directory with per-class docs. The README.md links to each class file. Generate these files:

Read `packages/fliwright-core/src/index.ts` to get the full export list. The main modules to document:

Sub-directory with per-class docs. The README.md links to each class file. Generate these files:

- `FliwrightDriver.md` — connect, disconnect, page, mock, healing, recorder, state, plugins
- `Page.md` — locator, waitFor, formHelper
- `Locator.md` — click, longPress, drag, pinch, type, fill, scrollIntoView, count, isVisible
- `Selector.md` — toWireFormat, toWireParams, selector formats (text=, key=, byType=)
- `Assertion.md` — toBeVisible, toHaveText, toContainText, toBeEnabled, toBeDisabled, .not negation, healing integration; include `createExpect` function and `AssertionError` class
- `MockManager.md` — route, removeRoute, clear, setPassthrough, getCalls
- `SelfHealingEngine.md` — recordSuccess, tryHeal, getReports, enabled
- `SnapshotStore.md` — save, load, list
- `RecorderController.md` — start, stop, getOperations, getRawEvents
- `CodeGenerator.md` — generate (TypeScript output)
- `DartCodeGenerator.md` — generate (Dart integration_test output)
- `AssertionSuggester.md` — suggest
- `FormHelper.md` — fill, analyze, fillFields
- `SemanticInferrer.md` — infer
- `FakerGenerator.md` — generate
- `SkillRegistry.md` — register, match, clear
- `JsonRuleLoader.md` — loadFromFile, loadFromDir, autoDiscover
- `SelectorResolver.md` — resolve (role mapping), includes `resolveSelector` function
- `PluginRegistry.md` — register, resolve, getStateAdapter, lifecycle hooks
- `Protocol.md` — JSON-RPC 2.0 message handling, createRequest, parseResponse
- `VMServiceConnector.md` — WebSocket connection, isolate management, onEvent
- `EventAggregator.md` — aggregate (raw events → semantic operations)
- `FailureCollector.md` — collect (screenshot + widget tree + source)
- `MultiDimensionalHealingStrategy.md` — heal, score, scoreDimensions, ngramSimilarity, StrategyWeights
- `types.md` — All exported types from types.ts and interfaces/*.ts

### @fliwright/mcp (`docs/features/mcp/`)

- `README.md` — Package overview with tool listing
- `fliwright-run.md` — Detailed: input schema, output schema, error handling, usage
- `fliwright-get-failure.md` — Detailed: failure entry structure, healing suggestion format
- `fliwright-generate-test.md` — Detailed: source parsing, widget extraction, code template
- `test-report.md` — Detailed: resource URI, data format

### @fliwright/vitest (`docs/features/vitest/`)

- `README.md` — Package overview
- `test.md` — test() fixture, createFliwrightTest, auto-driver lifecycle
- `expect.md` — expect() assertion with healing + failure context writing

### @fliwright/cli (`docs/features/cli/`)

- `README.md` — Package overview with config system (fliwright.config.ts via jiti, VM URL discovery)
- `run.md` — Detailed: run command, all options, reporter formats, Vitest integration
- `init.md` — Detailed: generated files, config template
- `doctor.md` — Detailed: all environment checks
- `record.md` — Detailed: recording options, code generation

### @fliwright/plugin-riverpod (`docs/features/plugin-riverpod/`)

- `README.md` — Package overview
- `RiverpodStateAdapter.md` — Detailed: read, write, watch, unwatch, listProviders, override, handleEvent

### fliwright-bridge (`docs/features/bridge/`)

- `README.md` — Package overview, FliwrightBridge lifecycle, ExtensionRegistry
- `GestureExtension.md` — Detailed: click, gesture (longPress/drag/pinch), coordinate system
- `InspectExtension.md` — Detailed: selector syntax, widget tree traversal, WidgetInfo format
- `TypeExtension.md` — Detailed: text input simulation, replaceAll, charDelay
- `ScrollExtension.md` — Detailed: Scrollable.ensureVisible, alignment, duration
- `SnapshotExtension.md` — Detailed: interactive widget types captured, metadata fields
- `RecordingExtension.md` — Detailed: pointer event capture, text polling, hitTest reverse lookup
- `FormExtractExtension.md` — Detailed: TextField/TextFormField/EditableText extraction, deduplication
- `RiverpodExtension.md` — Detailed: ProviderContainer setup, all provider operations
- `MockServerExtension.md` — Detailed: route matching, wildcard, passthrough, call logging
- `HttpOverrides.md` — Detailed: HTTP interception mechanism

---

## Common Mistakes

- **Documenting planned features.** Only document what exists in source code. If a PRD feature has no implementation, omit it. The `status` field should reflect what the code actually does.
- **Skipping cross-cutting docs.** The pipeline docs are the highest-value output for AI agents — they explain how components work together, which isn't obvious from reading individual package docs.
- **Omitting YAML frontmatter.** Agents use frontmatter metadata for filtering and routing. Every file must have it.
- **Guessing signatures.** Read the actual source code. Don't rely on memory or assumptions — method signatures may have changed since the last documentation run.
- **Overwriting CLAUDE.md.** Only append the reference line. Preserve all existing content.
- **Writing prose instead of tables.** AI agents parse structured data (tables, lists, code blocks) far more reliably than paragraphs. Use tables for API surfaces, lists for steps, code blocks for examples.
