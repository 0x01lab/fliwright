# Feature Documentation

AI-consumable feature documentation for this repository lives under
`docs/features/`. It summarizes every implemented feature with API signatures,
type definitions, and usage examples, organized for fast lookup by AI agents.

## How to read it (strictly on-demand)

`docs/features/index.md` is a ~23 KB lookup table of every package, class, tool,
and command. **Do not load it as a routine.** Use it only when you need to
discover which component owns a behavior.

When you need the *current* API of the exact component you are changing, open
**that specific per-class doc** directly — for example
`docs/features/core/Selector.md`, `docs/features/bridge/inspect.md`, or the
relevant package `README.md`. This keeps the loaded context small. The detailed
route list lives in the index and is not duplicated here.

## Regeneration

`docs/features/` is a generated artifact (gitignored). Regenerate it with the
`/document-features` command whenever source code changes significantly.
