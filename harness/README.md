# Fliwright Development Harness

The Harness is the repository's operating model for agent and human changes. It
keeps five kinds of knowledge separate and makes each one discoverable without
loading unrelated context:

| Domain | Holds | Open when |
| --- | --- | --- |
| `constraints/` | Quality rules and verification gates | A change needs a rule beyond `AGENTS.md` |
| `boundaries/` | Ownership, allowed dependency direction, and impact scope | Work crosses packages or ownership is unclear |
| `workflows/` | Delivery and maintenance procedures | Preparing a commit, PR, release, or other delivery artifact |
| `memory/` | Stable operational facts | Runtime setup, source locations, generated docs, or conflict policy matter |
| `specs/` | Product/design/plan routing and lifecycle | Extending a designed feature or creating a new design |

`AGENTS.md` is the only always-read contract. It links directly to the relevant
leaf for common work. Read this index only when no level-0 route answers the
question, then open one document from the selected domain.

## Disclosure Rules

1. Start from the task, source file, test, or command that is already known.
2. Open a routing document only to identify its single applicable leaf.
3. Prefer a package overview or a named API page over `docs/features/index.md`.
4. Treat indexes as discovery tools, not background reading.
5. Stop loading documents once the active task has enough authoritative context.

## Authority

When sources disagree, use this order:

1. Current source code and executable tests.
2. `AGENTS.md` and the relevant Harness constraint or boundary.
3. Generated `docs/features/` API reference.
4. Active product requirements and accepted specifications.
5. Historical plans, designs, and findings.

Update the lower-authority material when it no longer matches the higher one.
