# Learning Ledger

The ledger is the shared, reviewed memory of durable engineering lessons. It is
not a task diary and it must not store credentials, local VM URLs, or
device-specific state.

## Automatic Capture, Controlled Promotion

Run `node scripts/capture-harness-memory.mjs --base <git-ref> --slug <short-topic>` after a source
change. The command inspects the diff and creates a deterministic candidate in
`drafts/`; it records changed files and affected capability modules without
inventing conclusions.

Review the draft, add the verified lesson and its evidence, then move it to this
directory with `Status: accepted`. Only accepted entries count as shared memory.
This prevents an agent or one-off failure from silently becoming a repository
rule.

PR validation with `node scripts/verify-harness.mjs --base <git-ref>` requires an accepted
entry when source code or dependency manifests changed. Its `Changed-Files`
field must name every source or dependency-manifest path covered by the entry.
Update an existing entry when it is the same lesson; otherwise add a focused new
one. To include unstaged local work in that check, add `--working-tree`.

## Entry Schema

Every accepted entry uses this header:

```md
# Concise Lesson Title

- Status: accepted
- Date: YYYY-MM-DD
- Scope: package or cross-package capability
- Evidence: source/test/spec paths or issue reference
- Changed-Files: `packages/example/src/file.ts`, `packages/example/package.json`
- Supersedes: none or ledger filename

## Decision

The durable rule and why it exists.
```

Use a narrow scope and make the entry obsolete when a replacement rule lands.
