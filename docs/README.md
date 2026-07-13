# Documentation Guide

Documentation is split by purpose. Follow the smallest path that answers the
active question; this directory is not intended as a reading list.

| Need | Open |
| --- | --- |
| Repository operating rules, memory, boundaries, or delivery process | [../harness/README.md](../harness/README.md) |
| Product scope | [PRD.md](./PRD.md) |
| Current implemented API or behavior | A known page in [`features/`](./features/), or [`features/index.md`](./features/index.md) only to find an unknown owner |
| Design rationale or historical plan | [../harness/specs/README.md](../harness/specs/README.md) |
| Publishing a release | [release/publishing.md](./release/publishing.md) |

## Documentation States

- `features/`: generated implementation reference. Start with the known
  package README, API page, or pipeline page. Use `features/index.md` only to
  discover an unknown owner; never load it by default. Do not hand-edit these
  generated pages; regenerate them with `/document-features` after significant
  stable source changes.
- `superpowers/specs/`: design records. They explain why and intended behavior,
  but may be superseded by implementation.
- `superpowers/plans/`: historical execution records. Read only the plan for the
  feature being changed.
- `plans/`: focused operational or project plans.
- `release/`: release-specific procedures.

Keep hand-authored product, specification, and release documents aligned with
the current source.
