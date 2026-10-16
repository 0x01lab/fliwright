# Fliwright Developer Preview Compatibility

**Status:** Developer Preview
**Updated:** 2026-09-15

This page records the compatibility claims that are safe to make for the
current release line. A platform is not considered supported merely because a
package compiles on it; it must also pass the generated Flutter smoke path or
be listed as a package-level verification only.

## Version matrix

| Layer | Verified / required version | Notes |
| --- | --- | --- |
| Node.js | 20 or newer | Required by all public TypeScript packages. |
| TypeScript | 5.5 or newer in the workspace | Consumer projects may use a compatible newer version. |
| Vitest | 4.1.11 | `@fliwright/vitest`, CLI peer dependency, and generated projects use this line. |
| Dart SDK | 3.5 or newer, below 4.0 | Required by the published bridge packages. |
| Flutter | Stable channel; package constraints apply | The bridge runs only in debug/profile or test builds. |
| Design QA Flutter | 3.24 or newer | `fliwright_design_qa` is an optional Labs package. |

## Platform status

| Platform | Status | Evidence / limitation |
| --- | --- | --- |
| macOS desktop | Generated E2E smoke verified | Covers bridge startup, VM discovery, CLI execution, and report persistence. |
| Linux | Dart package and TypeScript CI verification | Generated desktop E2E is not the release gate on this runner. |
| Android | Package-level bridge support expected | A generated end-to-end device gate is still required before a stable claim. |
| iOS | Package-level bridge support expected | A generated end-to-end device gate is still required before a stable claim. |
| Web | Not release-gated | Dart VM Service and bridge behavior require a separate validation path. |
| Windows desktop | Not release-gated | Add a generated desktop smoke job before claiming stable support. |

## Runtime constraints

- Add a test-only Flutter entrypoint that calls `FliwrightBridge.init()`.
- Run the app in debug/profile or a Flutter test build; the bridge is inert in
  release mode and does not register VM Service extensions or mock servers.
- The app must expose a locally reachable Dart VM Service endpoint.
- `fliwright_design_qa`, Riverpod, MCP, and TDD are optional packages and are
  not required for the core CLI/Vitest journey.

## Release confidence

The current repository gate covers npm and pnpm local tarball consumers, an
exact-version npm registry consumer after publish, Dart package
analysis/tests, and one generated macOS Flutter smoke run. Stable 1.0 still
requires at least three independent external Flutter applications and a
declared compatibility/deprecation policy.
