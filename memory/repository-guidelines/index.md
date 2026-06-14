# Repository Guidelines Index

Read this index after `memory/index.md`. Then open the leaf documents that match
your task.

## Required For Most Work

- [Project Structure](./project-structure.md) - package layout and where code,
  tests, examples, and docs live.
- [Coding Constraints](./coding-constraints.md) - TypeScript and Dart style,
  module conventions, naming, and public export expectations.
- [Build And Test Commands](./build-and-test-commands.md) - common install,
  build, lint, test, Dart, and E2E commands.
- [Testing Guidelines](./testing-guidelines.md) - where tests belong and when
  regression tests are expected.

## Workflow And Maintenance

- [Commit And PR Guidelines](./commit-and-pr-guidelines.md) - commit message and
  pull request expectations.
- [Security And Configuration](./security-and-configuration.md) - generated
  files, local URLs, device config, fixtures, and secrets.
- [Feature Documentation](./feature-documentation.md) - AI-consumable feature
  docs under `docs/features/` and when to regenerate them.

## Task Routing

- For TypeScript package changes, read project structure, coding constraints,
  build/test commands, and testing guidelines.
- For Dart or Flutter bridge changes, read project structure, coding
  constraints, build/test commands, and testing guidelines.
- For MCP tools, selectors, protocol behavior, code generation, or Riverpod
  support, also read feature documentation before changing behavior.
- For documentation-only changes, read feature documentation and any leaf file
  whose content you are updating.
