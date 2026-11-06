# Verify the complete release graph on isolated runners

- Status: accepted
- Date: 2026-11-04
- Scope: CI and release tooling
- Evidence: `.github/workflows/ci.yml`, `.github/workflows/release-gate.yml`, `scripts/tests/release-packages.test.mjs`, `scripts/tests/publish-vscode.test.mjs`, `scripts/tests/verify-mobile-build.test.mjs`, `examples/go_router_demo/test/navigation_test.dart`, `packages/fliwright-vscode/tests/FliwrightSession.test.ts`
- Changed-Files: `examples/form_demo/lib/main.dart`, `examples/form_demo/analysis_options.yaml`, `examples/form_demo/pubspec.yaml`, `examples/go_router_demo/pubspec.yaml`, `examples/go_router_demo/test/navigation_test.dart`, `examples/riverpod_demo/pubspec.yaml`, `harness/stack/framework.json`, `packages/fliwright-design-qa/android/build.gradle`, `packages/fliwright-core/tests/RecorderCache.test.ts`, `packages/fliwright-native/tests/XctestSession.test.ts`, `packages/fliwright-native/tests/android/AndroidRecovery.test.ts`, `packages/fliwright-vscode/src/session/FliwrightSession.ts`, `packages/fliwright-vscode/tests/FliwrightSession.test.ts`
- Supersedes: none

## Decision

Public package discovery, version checks, tarball verification, publication order and registry consumption use the same manifest-derived graph. Workspace links do not supply built entry points on a fresh runner; build dependencies before type checking or packaging. Load the Vitest fixture within a real suite, because importing its extended test object in a plain Node process is invalid.

Every release tag must belong to main history and pass the reusable full CI workflow for public delivery. Cloud server, worker and protocol are deferred and excluded from this public release gate. A single aggregate check fails on failed, cancelled or skipped dependencies and is required by main branch protection. Keep package suites sequential in CI with at most two workers per suite to avoid contention invalidating bounded timing tests.

Mobile compilation uses disposable hosts containing the owned native fixtures and all local published plugins. Record the reviewed generated-host toolchain in framework.json: the approved mobile_scanner expects external Kotlin on AGP 8 and does not work with Flutter's AGP 9 template plus disabled built-in Kotlin.

Stress tests that archive 1000 frames or complete two durable recovery transactions need explicit bounded budgets; their assertions verify queue limits and no repeated writes, rather than machine-specific wall-clock throughput. XCTest replacement remains unverified: tests must cover the runtime capability gate and password rejection at the adapter boundary without claiming device-verified support.

Each published Dart package has an explicit .pubignore excluding build caches, local overrides and runtime state, so archive hygiene does not depend on a parent checkout gitignore. Demos with local path dependencies declare publish_to: none.

Navigation demos need widget tests so the unconditional Flutter test gate can verify their consumer behavior. A root demo path dependency must also override the hosted bridge dependency of its local Riverpod adapter; pub ignores transitive packages' own overrides.

The VS Code session must require a compatible initialized bridge before exposing connected commands: the core driver's best-effort SDK handshake does not provide that guarantee. Cover missing, incompatible and uninitialized bridges and dispose rejected drivers.
