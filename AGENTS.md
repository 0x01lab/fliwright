# Repository Agent Instructions

Before working in this repository, read [memory/index.md](./memory/index.md).

This file is intentionally only a bootstrap declaration. The repository rules,
coding constraints, commands, testing expectations, security notes, and feature
documentation routes live under `memory/` and must be loaded progressively from
that index. Do not duplicate that content here.

## Mandatory: read before generating code

Before writing, modifying, or generating any code in this repository — including
test code, generated snippets, and code produced via tooling or skills — you
MUST first read the relevant `memory/` content:

1. Read [memory/index.md](./memory/index.md), then
   [memory/repository-guidelines/index.md](./memory/repository-guidelines/index.md).
2. Follow its **Task Routing** to open the smallest set of leaf documents that
   apply to the task (project structure, coding constraints, build/test
   commands, testing guidelines, security/configuration, and feature
   documentation as relevant).
3. Only after reading those documents, proceed to generate code that follows the
   conventions, naming, module layout, and test expectations they define.

Do not generate code from prior assumptions. If a task touches MCP tools,
selectors, protocol behavior, code generation, self-healing, form filling, or
Riverpod support, also read the matching feature documentation under
`docs/features/` (see [feature-documentation.md](./memory/repository-guidelines/feature-documentation.md))
before changing behavior.
