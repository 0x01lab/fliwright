# Harness Governance Baseline

- Status: accepted
- Date: 2026-07-11
- Scope: cross-package governance
- Evidence: `harness/architecture/dependency-rules.json`, `harness/stack/framework.json`, `scripts/verify-harness.mjs`
- Changed-Files: `package.json`, `packages/fliwright-vscode/package.json`, `e2e/tsconfig.json`, `packages/fliwright-mcp/tsconfig.json`, `packages/fliwright-plugin-riverpod/tsconfig.json`
- Supersedes: none

## Decision

Fliwright uses a reviewed dependency graph and a checked stack manifest as its
single governance baseline. New package dependencies, dependency versions, or
cross-package imports must update the relevant approved manifest and pass
`node scripts/verify-harness.mjs`. Source changes also produce a reviewed ledger entry so
durable engineering knowledge remains shared and traceable.
