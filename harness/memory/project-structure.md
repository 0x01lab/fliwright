# Project Structure Memory

This is a mixed TypeScript and Dart/Flutter workspace. TypeScript packages live
under `packages/*/src` with tests in matching `packages/*/tests` directories.
Core automation APIs are in `packages/fliwright-core`; the MCP server is in
`packages/fliwright-mcp`; Vitest integration is in `packages/fliwright-vitest`;
Riverpod support is in `packages/fliwright-plugin-riverpod`. The Dart bridge
lives in `packages/fliwright-bridge/lib` with tests in
`packages/fliwright-bridge/test`. End-to-end smoke tests are in `e2e`, the
Flutter demo app is in `examples/riverpod_demo`, and design notes are in `docs`.

Per-project Fliwright runtime state lives under the target project's
`.fliwright` directory. In particular, `.fliwright/config.json` is the local
runtime config file that may contain the currently active Flutter VM Service URL
written by the VS Code extension. See [runtime-configuration.md](./runtime-configuration.md)
for the URL resolution priority and file shape.
