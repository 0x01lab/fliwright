---
name: fliwright-flows
description: Create, validate, clean, generate tests from, or review Fliwright business-flow documents. Use for `.fliwright/flows/*.flow.json`, recording-to-flow conversion, Figma bindings, runtime-versus-Figma visual reviews, flow validation, agent specs, or `fliwright flow` workflows.
---

# Fliwright Business Flows

Use a Fliwright flow to make a user journey portable across recording, test
generation, Figma review, and implementation work. A flow is not a timeline
test: it is an editable `.fliwright/flows/<id>.flow.json` document.

## First Decision

- Use `write-fliwright-tests` when the task is primarily a runnable
  `@fliwright/vitest` test or script.
- Use this skill when the durable artifact is a flow document, a flow-derived
  implementation plan, or a Figma-backed UI review.
- Use `fliwright-cli-workflows` when CLI discovery or command availability is
  the blocker.

## Workflow

1. Inspect existing `.fliwright/flows/*.flow.json` and nearby tests before
   creating a flow. Reuse stable route, selector, and code-target vocabulary.
2. Build from the right source:
   - recording: preserve meaningful frames and actions;
   - timeline: preserve page, assertion, mock, agent, optional, and manual
     boundaries;
   - manual: add only behavior that has a verifiable route, selector, or note.
3. Bind Figma only when the node has an actual design URL or explicit
   `fileKey` and `nodeId`. Never invent bindings.
4. Run structural validation before generating a test or review plan.
5. Generate a test skeleton as a starting point, then use
   `write-fliwright-tests` to turn it into a robust committed test.

## Flow Shape

- Store flow files under `.fliwright/flows/` as `<id>.flow.json`.
- Use a `screen` node for a route or stable visual state, an `action` node for
  user intent, an `assertion` node for observable outcome, and a `decision`
  node for a real conditional branch.
- Retain mock and agent nodes when they describe meaningful behavior. Remove
  noisy exploratory actions only after confirming they are not required for
  state progression.
- Keep selectors stable and query-based. A recording ref or coordinate alone
  is evidence, not a durable test contract.

## Figma Review

- Bind a node to Figma before asking for a visual review.
- A review target also needs a runtime entry point: route, selector, recording
  frame, or runtime screenshot.
- Treat visual diff as evidence for review, not as an automatic source rewrite.
  Investigate layout, content, design-token, and component-mapping differences
  before changing code.
- Keep Figma credentials outside flow files and source control.

## Commands

Discover input with `fliwright schema flow.review-run --json` and other `flow.*` command schemas. Use `--input file.json` for structured capture arrays. Runtime captures can use a connection session; local Flow reading, generation and reporting work offline. Use external Figma MCP only for Figma design context.
