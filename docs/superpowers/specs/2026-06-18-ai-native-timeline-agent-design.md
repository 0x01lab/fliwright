# AI Native Timeline Agent Design

This document is the runtime/UI contract for timeline-aware Fliwright scripts,
tests, MCP tools, and editor views.

## Timeline Data

`timeline.json` is written under `.fliwright/runs/<runId>/timeline.json`.
It is the stable artifact consumed by UI and external agents.

Required run fields:

- `version`: currently `1`.
- `runId`: unique run identifier.
- `testName`: script or test name.
- `mode`: `script` or `test`.
- `status`: `running`, `passed`, or `failed`.
- `startedAt` / `endedAt`: ISO timestamps.
- `nodes`: ordered timeline nodes.
- `agentVisibleFailures`: optional passive-AI-readable failures.

Required node fields:

- `id`: stable within one run.
- `kind`: `script`, `page`, `frame`, `step`, `branch`, `optional`, `assertion`, `action`, `mock`, `ai-call`, or `failure`.
- `title`: human-readable summary.
- `status`: `running`, `passed`, `failed`, or `skipped`.
- `startedAt` / `endedAt`: ISO timestamps.

Optional node fields:

- `parentId`: parent node id for nested page/step/frame/branch layout.
- `route`: page or frame route.
- `codeRef`: source location.
- `artifacts`: screenshot, snapshot, diagnostics, log, or AI artifact refs.
- `metadata`: kind-specific structured data.
- `error`: `AgentVisibleFailure`.

## Artifact Paths

Artifact paths are relative to the run directory:

- `artifacts/screenshots/<nodeId>.png`
- `artifacts/snapshots/<nodeId>.json`
- `artifacts/diagnostics/<nodeId>.json`

Reports may include absolute `timeline.json` paths, but timeline node artifact
refs stay relative so a run directory can be moved as one unit.

## AI Nodes

Active AI calls are explicit authoring actions:

```json
{
  "kind": "ai-call",
  "title": "Generate register payload",
  "metadata": {
    "mode": "active",
    "responseFormat": "json",
    "hasSchema": true,
    "hasFallback": true
  }
}
```

Passive diagnosis is opt-in and never replaces the original failure:

```json
{
  "kind": "ai-call",
  "title": "Diagnose: Next button enabled",
  "metadata": {
    "mode": "passive-diagnosis",
    "failureCode": "assertion_failed",
    "timelineNodeId": "assertion-7"
  }
}
```

Runtime repair proposals are audit nodes with `mode: "runtime-repair"`. Code
patch proposals must be rejected; allowed runtime actions are click, wait,
dismissModal, retryStep, and observe.

## UI Grouping

Recommended grouping and color semantics:

- `script`: top-level run container, neutral while running.
- `page`: route or screen grouping, blue/indigo accent.
- `frame`: captured visual state, image/snapshot preview affordance.
- `step`: procedural action group, green when passed, red when failed.
- `branch`: fallback or conditional path, amber accent.
- `optional`: grey when skipped, normal step styling when executed.
- `assertion`: checkmark icon when passed, red cross when failed.
- `mock`: network/mock setup, teal accent.
- `ai-call`: sparkle/agent icon; active and passive modes shown distinctly.
- `failure`: red terminal node with recovery hints.

The UI should show the node tree by `parentId`, preserve original order, and let
agents or users open artifacts without reading source code.

## Example: Auto Register Fill

```json
{
  "version": 1,
  "runId": "run-auto-register",
  "testName": "auto register fill",
  "mode": "script",
  "status": "passed",
  "nodes": [
    {
      "id": "step-1",
      "kind": "step",
      "title": "Generate register data",
      "status": "passed"
    },
    {
      "id": "page-2",
      "kind": "page",
      "title": "Register",
      "route": "/register",
      "status": "passed"
    },
    {
      "id": "step-3",
      "parentId": "page-2",
      "kind": "step",
      "title": "Navigate to register",
      "status": "passed"
    },
    {
      "id": "frame-4",
      "parentId": "page-2",
      "kind": "frame",
      "title": "Register form visible",
      "status": "passed",
      "artifacts": [
        {
          "kind": "screenshot",
          "path": "artifacts/screenshots/frame-4.png",
          "mimeType": "image/png"
        },
        {
          "kind": "snapshot",
          "path": "artifacts/snapshots/frame-4.json",
          "mimeType": "application/json"
        }
      ]
    },
    {
      "id": "step-5",
      "parentId": "page-2",
      "kind": "step",
      "title": "Fill credentials",
      "status": "passed"
    },
    {
      "id": "optional-6",
      "parentId": "page-2",
      "kind": "optional",
      "title": "Fill referral",
      "status": "skipped"
    },
    {
      "id": "frame-7",
      "parentId": "page-2",
      "kind": "frame",
      "title": "Register form filled",
      "status": "passed"
    }
  ]
}
```
