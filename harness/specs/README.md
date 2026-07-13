# Specification Routing

Specifications explain intended behavior; they are not the default source for
current implementation details. Open a spec only when the task extends, repairs,
or evaluates the behavior it defines.

## Choose One Source

| Need | Start here |
| --- | --- |
| Product scope and success criteria | [../../docs/PRD.md](../../docs/PRD.md) |
| Existing feature design or decision rationale | The matching file in `docs/superpowers/specs/` |
| Historical implementation sequence | The matching file in `docs/superpowers/plans/` |
| Current implementation/API contract | [../../docs/README.md](../../docs/README.md) |
| New work needing a design | Create a focused design in `docs/superpowers/specs/`, then an execution plan only when the work merits one |

Do not read the full `docs/superpowers/` tree. Locate a known slice by filename,
or use `rg` on titles/keywords, and open only the matching document plus any
explicit parent design it names.

## Lifecycle

1. Define or update the intended behavior in a focused spec when the work has
   meaningful API, protocol, architecture, or user-workflow impact.
2. Implement in the owning package, with tests at the affected boundary.
3. Treat source and tests as the current truth once implementation lands.
4. Regenerate `docs/features/` after significant stable API changes.
5. Mark plans and designs as historical context when their assumptions no longer
   match implementation; do not preserve obsolete behavior merely because a plan
   recorded it.
