# Serializable Finder Protocol

- Status: accepted
- Date: 2026-07-11
- Scope: `@fliwright/core` selector API and `fliwright_bridge` inspect protocol
- Evidence: `packages/fliwright-core/tests/FlutterFinderParity.test.ts`, `packages/fliwright-core/tests/Selector.test.ts`, `packages/fliwright-core/tests/DartCodeGenerator.test.ts`, `packages/fliwright-bridge/test/element_finding_test.dart`, `harness/capabilities/packages/core.md`
- Changed-Files: `packages/fliwright-core/src/Page.ts`, `packages/fliwright-core/src/Locator.ts`, `packages/fliwright-core/src/Selector.ts`, `packages/fliwright-core/src/DartCodeGenerator.ts`, `packages/fliwright-core/src/types.ts`, `packages/fliwright-core/src/index.ts`, `packages/fliwright-bridge/lib/src/extensions/inspect.dart`, `scripts/generate-harness-capabilities.mjs`
- Supersedes: none

## Decision

Finder helpers exposed by the TypeScript runtime must reduce to serializable
`SelectorQuery` values that the Dart VM-Service bridge can evaluate. Express
parent-with-descendant lookup through `containing`, which maps to Flutter
`find.ancestor(of: descendant, matching: parent)`, and preserve the same
orientation in generated Dart tests. The Harness capability generator must
include both value and type re-exports so public selector types remain
discoverable. Keep helpers that require a Dart object, closure, element class,
or image provider outside this cross-process API.
