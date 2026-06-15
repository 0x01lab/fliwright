---
name: document-features
description: "Summarize implemented features from source code and generate indexed markdown documentation under docs/features/ for AI agent consumption. Use this skill whenever the user asks to document features, generate feature docs, create API documentation, summarize what's implemented, index features, or wants an overview of the project's capabilities — even if they don't use the exact phrase 'document features'."
---

# Document Features

Generate structured, AI-agent-consumable documentation for every implemented feature in this project. The output lives in `docs/features/` with an `index.md` routing table that lets any AI agent quickly navigate the codebase's capabilities.

## Why This Exists

AI agents working on this codebase need to understand what's implemented without reading every source file. These docs act as a compressed map of the project — accurate, structured, and indexed for fast lookup. They are NOT for human end-users; they are for the next Claude session, the MCP agent, or any AI tool that needs to answer "can this project do X?"

## Core Principle: Derive Everything From Source

**Never hardcode which files, classes, tools, commands, or packages to document.** This project evolves fast; a hardcoded inventory goes stale within one change (the previous version of this skill listed 4 MCP tools when the code had 18). Instead, this skill defines **rules** — *where to read* and *how to structure* — and you derive the complete, current set of doc targets from the source code at run time. If something exists in code, it gets documented; if it doesn't, it doesn't.

## Output Directory

All generated files go to `docs/features/`. On each run, **clear the entire directory first** and regenerate everything — this ensures consistency.

The output has three layers. The *shape* is fixed; the *file list* is derived from source:

1. **Per-package sub-directory** — one directory under `docs/features/` per package in the monorepo (enumerate from `pnpm-workspace.yaml` + `packages/*/package.json`). TS libraries, the Dart bridge, the Dart Riverpod adapter, and the VS Code extension each get their own directory.
2. **Per-export detailed docs** — inside each package directory, one `.md` per export target (class / tool / command / extension / view — see derivation rules in Step 2), plus a `README.md` overview and (for TS packages) a `types.md`.
3. **Cross-cutting pipeline docs** — a handful of top-level `*-pipeline.md` / `*-integration.md` files tracing how packages collaborate end-to-end.

Illustrative shape (do NOT treat as exhaustive — derive the real list from source):

```
docs/features/
├── index.md                  # Routing table (generated last)
├── <package>/                # One directory per package
│   ├── README.md             # Package overview + module table
│   ├── <Export>.md           # One per exported class/tool/command
│   └── types.md              # TS packages only: all types/interfaces
└── <name>-pipeline.md        # Cross-cutting pipelines (one per capability)
```

Every file MUST carry YAML frontmatter. Agents use it for routing.

## Workflow

Follow these steps in order. Each step builds on the previous one.

### Step 1: Clear and enumerate packages

Delete everything in `docs/features/` (create it if missing), then enumerate the monorepo:

- Read `pnpm-workspace.yaml` and every `packages/*/package.json` to get the **authoritative package list**, names, versions, dependencies, and type (TS lib / MCP / CLI / Dart / VS Code / plugin).
- For each package, locate its public entry point(s) per the derivation rules below.

### Step 2: Derive the doc targets for each package

For every package from Step 1, read its public surface **from source** and produce one doc target per exported unit. Use this table to know what to read:

| Package type | How to recognize | Read this to get the doc targets |
|---|---|---|
| TS library (`@fliwright/*`) | has `src/index.ts` | every `export` in `src/index.ts`; open each class's source file to read its methods/properties |
| MCP server | package with an MCP server entry | every tool registered (grep `server.tool(` and/or list `src/tools/`) + every resource |
| CLI | package exposing `bin` or a `commands/` dir | every file in `commands/` → one command; every file in `capabilities/` → one capability; plus `config.ts`, `reporter.ts` |
| Dart bridge | `lib/<pkg>.dart` + `lib/src/extensions/` | the barrel export + every `_registry.register(...)` call across `lib/src/extensions/*.dart` |
| Dart adapter | `lib/*.dart` exporting an observer/adapter | each exported adapter class |
| VS Code extension | `package.json` with `engines.vscode` | `contributes.commands/views/settings/menus` + `src/extension.ts` activation points + each `src/<area>/` module |
| Plugin | exports a `FliwrightPlugin` / `StateAdapter` | the plugin object + its adapter(s) |

**Rules for grouping targets into files:**

- One exported class → one `<ClassName>.md`.
- Standalone exported functions from the **same source file** → group into one doc named after the file (e.g. `wire-protocol.md`).
- All exported types and interfaces of a TS package → one `types.md`.
- Each MCP tool and each resource → its own doc.
- Each CLI command and each capability → its own doc.
- Each Dart bridge extension → its own doc.

**Use the actual source code as the single source of truth.** Do NOT document features from PRD or design specs that don't exist in code yet. Read signatures from source — never reconstruct them from memory.

### Step 3: Map cross-cutting pipelines

Trace these end-to-end capabilities by following import chains through the code. **Verify every file in each trace path still exists** — rename or repoint if the code has moved. If you find a new end-to-end capability not listed here, add a pipeline doc for it.

| Pipeline | Trace path (verify against current code) |
|---|---|
| Self-healing | assertion entry → `SelfHealingEngine` → `SnapshotStore` → healing strategy → bridge snapshot extension |
| Recording & codegen | `RecorderController` → `EventAggregator` → code generators → `AssertionSuggester` → bridge recording extension |
| Form auto-fill | `FormHelper` → `SemanticInferrer` → `FakerGenerator` → `SkillRegistry`/`JsonRuleLoader` → `SelectorResolver` → bridge form extension |
| MCP integration | vitest reporter → MCP server → MCP tools → MCP resources |

### Step 4: Generate per-package sub-directories with per-class docs

For each package, create its sub-directory with a `README.md` overview and one detailed markdown file per doc target derived in Step 2.

#### 4a. Package README

```markdown
---
package: "<package name from package.json>"
version: "<from package.json>"
layer: <core | integration | transport | plugin | tooling | editor>
status: implemented
generated: "<today's date YYYY-MM-DD>"
---

# <package name>

> One-line summary of what this package does.

## Modules

| Module | Description | Doc |
|--------|-------------|-----|
| `<Export>` | One-line description | [<Export>.md](./<Export>.md) |

## Dependencies

- `dependency-name` — version (from package.json)

## Usage Example

\```typescript
// A complete, runnable snippet demonstrating the package's primary use case
\```
```

#### 4b. Per-class detailed docs

For each exported class, write `docs/features/<package-dir>/<ClassName>.md`:

```markdown
---
module: "<ClassName>"
package: "<package name>"
source: "<relative path to source file>"
tests: "<relative path to test file>"
generated: "<today's date YYYY-MM-DD>"
---

# <ClassName>

> One-line summary of this class's responsibility and role in the system.

## Overview

2-3 sentences: what it does, why it exists, how it fits into the architecture, and what depends on it.

## Constructor

\```typescript
constructor(param1: Type1, param2?: Type2)
\```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param1` | `Type1` | Yes | What this controls |

## Public Methods

### `methodName(param: Type): ReturnType`

What this does, when to call it, side effects.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `param` | `Type` | Yes | Description |

**Returns:** `ReturnType` — what it represents.
**Throws:** `ErrorType` — when and why.
**Example:** *(read a real call site from the codebase)*

\```typescript
const result = instance.methodName('value');
\```

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `propName` | `Type` | Yes | Description |

## Related

- **Depends on:** [OtherClass](./OtherClass.md)
- **Used by:** [ConsumerClass](./ConsumerClass.md)
- **Test:** `tests/ClassName.test.ts`
- **Source:** `src/ClassName.ts`
```

#### 4c. Types doc

```markdown
---
module: "types"
package: "<package name>"
source: "src/types.ts"
generated: "<today's date YYYY-MM-DD>"
---

# Types & Interfaces

## Type Aliases

### `TypeName`
\```typescript
type TypeName = string | { text: string; ancestor?: TypeName };
\```
When/how this type is used.

## Interfaces

### `InterfaceName`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field` | `string` | Yes | Description |

**Used by:** [ClassName](./ClassName.md)
```

#### 4d. Utility function docs

For exported standalone functions, group those from the same source file:

```markdown
---
module: "<source-file-name>"
package: "<package name>"
source: "src/<file>.ts"
generated: "<today's date YYYY-MM-DD>"
---

# Utility Functions

## `functionName(param: Type): ReturnType`

What this function does.

| Parameter | Type | Description |
|-----------|------|-------------|
| `param` | `Type` | Description |

**Returns:** `ReturnType`
**Example:**

\```typescript
import { functionName } from '<package>';
const result = functionName('value');
\```
```

### Step 5: Generate cross-cutting pipeline docs

For each pipeline from Step 3, write a top-level markdown file:

```markdown
---
feature: "<Pipeline Name>"
packages: ["<package>", "..."]
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

## Agent Integration

How an AI agent invokes/benefits from this. Include MCP tool names if applicable.

## Data Flow

\```
ASCII diagram showing stages and data flow between components.
\```

## Key Files

- `packages/<package>/src/<file>.ts` — brief description of the file's role
```

### Step 6: Generate index.md

Write `docs/features/index.md` with exactly these five sections. **Fill every row from the data derived in Steps 2–5** — do not hardcode entries:

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
| `<pkg>` | <one-line> | [<dir>/README.md](./<dir>/README.md) | <comma-separated export names> |

## By Class

| Class | Package | Description | Doc |
|-------|---------|-------------|-----|
| `<Class>` | <pkg> | <one-line> | [<dir>/<Class>.md](./<dir>/<Class>.md) |

## By Feature Slice

| Feature | Packages | Doc | Agent-Accessible | Status |
|---------|----------|-----|------------------|--------|
| <Pipeline> | <pkgs> | [<file>.md](./<file>.md) | <how> | Implemented |

## MCP Tool Quick Reference

| Tool | Input (key fields) | Output | Doc |
|------|--------------------|--------|-----|
| `<tool>` | <fields> | <result> | [mcp/<tool>.md](./mcp/<tool>.md) |

## Quick Start for AI Agents

1. To **run tests**: ...
2. To **diagnose failures**: ...
3. To **generate tests**: ...
4. To **record interactions**: ...
5. To **manipulate state**: ...
6. (add one bullet per major capability present in the code)
```

### Step 7: Update AGENTS.md

Check if `AGENTS.md` already contains a `## Feature Documentation` section. If it does, update the links to match the new sub-directory structure. If it doesn't, **append** (do NOT overwrite) a new section at the end:

```markdown

## Feature Documentation

AI-consumable feature documentation lives in `docs/features/`. These docs summarize every implemented feature with full API signatures, type definitions, and usage examples, organized for fast lookup by AI agents.

- **Start here:** [docs/features/index.md](./docs/features/index.md) — routing table by package and by feature slice, MCP tool quick reference, agent quick-start guide
- **Per-package overviews:** each package has a `README.md` under `docs/features/<package>/`
- **Per-class detailed docs:** one `.md` per exported class/tool/command inside each package directory
- **Cross-cutting pipelines:** top-level `*-pipeline.md` / `*-integration.md` files

Regenerate with `/document-features` when source code changes significantly.
```

Do NOT modify `CLAUDE.md` — it only references `AGENTS.md`.

---

## Common Mistakes

- **Hardcoding inventories in the skill or output.** This is the #1 mistake. File lists, class lists, tool lists, command lists — all of them drift. Derive every target from source at run time using the Step 2 rules. This skill intentionally contains no such list.
- **Documenting planned features.** Only document what exists in source code. If a PRD feature has no implementation, omit it. The `status` field should reflect what the code actually does.
- **Skipping cross-cutting docs.** The pipeline docs are the highest-value output for AI agents — they explain how components work together, which isn't obvious from reading individual package docs.
- **Omitting YAML frontmatter.** Agents use frontmatter metadata for filtering and routing. Every file must have it.
- **Guessing signatures.** Read the actual source code. Don't rely on memory or assumptions — method signatures may have changed since the last documentation run.
- **Overwriting CLAUDE.md.** Only AGENTS.md gets a `## Feature Documentation` section (appended/updated). CLAUDE.md only references AGENTS.md — leave it alone.
- **Writing prose instead of tables.** AI agents parse structured data (tables, lists, code blocks) far more reliably than paragraphs. Use tables for API surfaces, lists for steps, code blocks for examples.
