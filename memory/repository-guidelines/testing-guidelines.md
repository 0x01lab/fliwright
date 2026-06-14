# Testing Guidelines

Vitest is the TypeScript test framework. Place focused unit tests beside each
package in `tests`, mirroring the source subject, for example `Locator.test.ts`
or `runTest.test.ts`. Add regression tests when changing selectors, protocol
behavior, MCP tools, or code generation. Dart bridge tests use `dart test`;
Flutter demo tests live under `examples/riverpod_demo/test`.
