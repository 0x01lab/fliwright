# Validate release inputs before publishing npm packages

- Status: accepted
- Date: 2026-11-04
- Scope: npm publishing and governed Flutter examples
- Evidence: `.github/workflows/publish-npm.yml`, `.github/workflows/release-gate.yml`, `.github/workflows/ci.yml`, `examples/go_router_demo/test/navigation_test.dart`, `scripts/verify-registry-consumer.mjs`
- Changed-Files: `examples/form_demo/lib/main.dart`, `examples/form_demo/pubspec.yaml`, `examples/go_router_demo/pubspec.yaml`
- Supersedes: none

## Decision

Require the tagged npm release commit to be in main history and rerun the full
CI before publishing. Build workspace packages before linting consumers and run
package tests sequentially with two workers to avoid timing-test contention.
An aggregate CI quality gate must fail if any required job fails or is skipped.

Flutter demo apps with local path dependencies are not publishable packages.
Declare `publish_to: none`; analyzer configuration must reference only declared
lint dependencies. Keep the navigation demo covered by a real widget test so
its CI test command validates a working route instead of failing on no tests.

Registry consumer dependencies use plain versions. Load the Vitest fixture
inside an actual Vitest run rather than importing its test API from standalone
Node. Authentication and package-management queries cannot prove npm publish
permission; only an authorized registry publish verifies that operation.

Nested Vitest CLI assertions must strip terminal control sequences before
matching summary text: GitHub Actions enables colors and splits visible words
with ANSI escapes. Test outcomes and artifact assertions remain unchanged.
Flutter consumers of the local Riverpod adapter must override its hosted bridge
dependency to the same local bridge checkout to avoid conflicting sources.
