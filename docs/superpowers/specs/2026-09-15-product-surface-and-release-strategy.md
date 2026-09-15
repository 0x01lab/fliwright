# Fliwright Product Surface and Release Strategy

**Date:** 2026-09-15  
**Status:** Proposed  
**Decision scope:** Product positioning, public surfaces, package boundaries, and release gates

Related evidence: [MCP and CLI product-surface research](../../plans/2026-09-15-mcp-cli-product-surface-research.md)

## 1. Decision summary

Fliwright should not be positioned as a general-purpose testing tool across
application stacks. It should be released as a Flutter-specific, white-box E2E
automation framework with Playwright-style TypeScript APIs and agent-native
diagnostics.

The CLI becomes the authoritative operator and automation surface. MCP remains
an optional, thin agent adapter over the same application use cases. MCP must
not own behavior that is unavailable from the CLI or shared application API.

The first public release should be labeled **Developer Preview**. A stable
release is gated on clean registry installation, a real Flutter E2E CI path,
and validation in external applications.

## 2. Target product

### 2.1 Positioning

> Playwright-style white-box E2E testing for Flutter, with deterministic app
> scenarios and structured diagnostics for developers and coding agents.

### 2.2 Primary user

A Flutter developer or product team that:

- owns the application source and can add a test-only bridge entrypoint;
- needs repeatable local and CI E2E tests;
- wants better Widget semantics, state setup, network control, and failure
  artifacts than a purely black-box driver can provide; and
- may use an AI coding agent, but does not require one to use Fliwright.

### 2.3 Explicit non-goals for the first stable release

- Cross-framework Web, React Native, or native iOS/Android testing.
- Testing arbitrary production APK/IPA binaries without instrumentation.
- A hosted device farm or SaaS execution control plane.
- Figma Design QA, autonomous repair, and business-flow authoring as required
  parts of the core installation.
- Replacing Flutter unit and widget tests.

## 3. Product surface

### 3.1 Core user journey

The supported happy path must be no longer than:

```text
fliwright init
flutter run -t test_driver/fliwright_app.dart
fliwright run
```

`fliwright init` must generate compatible dependencies and a passing example.
`fliwright run` must discover or consume the VM Service endpoint, run the test,
return a correct exit code, and produce a stable machine-readable report.

### 3.2 Capability tiers

#### Core

- App connection and capability negotiation.
- Locator, action, wait, and assertion APIs.
- Screenshot, Widget snapshot, timeline, and failure artifacts.
- Deterministic scenarios and reset.
- CLI runner and Vitest adapter.

#### Optional integrations

- HTTP and WebSocket mocks.
- Riverpod state observation and controlled writes.
- VS Code extension.
- MCP adapter.

#### Labs

- AI diagnosis and repair.
- Persistent TDD daemon.
- Business-flow and Figma review workflows.
- Design QA pairing and capture.

Labs capabilities must not add transitive runtime dependencies to the core
Flutter bridge or change the default CLI/MCP surface.

## 4. CLI and MCP decision

### 4.1 Why CLI is authoritative

The CLI is available to developers, CI systems, scripts, and all coding agents
that can run a shell. It has observable process boundaries, conventional exit
codes, simple reproduction, and does not require an MCP-capable host.

Every public CLI operation must support:

- non-interactive execution;
- stable exit codes;
- `--json` output with a versioned schema;
- explicit timeout and cancellation behavior;
- stdout reserved for the selected result format and diagnostics on stderr;
- secret-safe logging; and
- a printed reproduction command on failure.

### 4.2 Why MCP remains

MCP provides structured discovery, typed arguments, resources, and efficient
access to a long-lived Flutter session. Those are useful for interactive agent
work, especially repeated observe/act/diagnose cycles. Removing MCP would lose
these benefits and force agents to parse human-oriented terminal output.

MCP is therefore retained as an adapter, not a second product runtime.

### 4.3 Shared use-case boundary

```text
                   +----------------------+
                   | application use cases|
                   | connect / observe     |
                   | interact / run        |
                   | scenario / artifacts  |
                   +----------+-----------+
                              |
          +-------------------+-------------------+
          |                   |                   |
        CLI                 MCP adapter       VS Code/Vitest
   process + JSON       typed agent tools      native adapters
```

CLI and MCP should call the same in-process application services. MCP should
not shell out to the CLI for every operation, because a long-lived VM Service
connection and cancellation state are valuable. The CLI remains the behavioral
contract: every MCP mutation must have an equivalent shared use case and CLI
command, while MCP may expose session-aware composition.

### 4.4 Proposed CLI information architecture

```text
fliwright init
fliwright doctor
fliwright app status|connect|observe|screenshot
fliwright run [test]
fliwright scenario list|apply|reset
fliwright mock list|apply|clear|calls
fliwright record start|stop|generate
fliwright artifacts show|export
fliwright tdd ...                  # labs
fliwright flow ...                 # labs
```

Commands that read live state should support JSON snapshots. Long-running
commands should optionally emit versioned NDJSON events.

### 4.5 Proposed MCP core profile

Reduce the default profile from fifteen low-level tools to approximately eight
intent-level tools:

- `fliwright_status`
- `fliwright_connect`
- `fliwright_observe`
- `fliwright_interact`
- `fliwright_run`
- `fliwright_scenario`
- `fliwright_mock`
- `fliwright_record`

Expose reports, timelines, capabilities, and flow documents as MCP resources or
resource templates where they are read-only. Keep `development`, `tdd`, and
`flow` as opt-in profiles. Deprecate the `full` profile for normal use and keep
it only during a documented migration window.

The existing `core`, `development`, `tdd`, `flow`, and `full` profile mechanism
is the migration foundation; this proposal consolidates the default contracts
rather than replacing the profile architecture.

## 5. Package boundary changes

### 5.1 Flutter packages

- `fliwright_bridge`: minimal test bridge. No Figma, QR, WebRTC, or scanner
  dependencies.
- `fliwright_bridge_riverpod`: optional Riverpod integration.
- `fliwright_design_qa`: separately installable labs product with its own
  publication lifecycle.

The base bridge must fail closed or be compiled out in release mode. Public
documentation must specify supported Flutter versions and platforms.

### 5.2 TypeScript packages

- `@fliwright/core`: protocol and reusable automation domain.
- `@fliwright/vitest`: Vitest adapter.
- `@fliwright/cli`: primary executable and configuration API.
- `@fliwright/mcp`: optional agent adapter.
- `@fliwright/tdd`: labs until persistent-runtime compatibility is proven.

Consider a later `@fliwright/test` convenience package only if external user
testing shows that installing CLI and Vitest separately causes material
confusion. Do not add it merely to hide unresolved package boundaries.

Every npm package must declare license, repository, bugs, engines, exports,
files, and publishConfig; contain a package README; and pass a tarball-content
test. Workspace dependency versions must be converted to publishable versions
during release.

## 6. Execution roadmap

### Phase 0: Restore truthful contracts

**Objective:** Make repository documentation and generated surfaces describe
the current product.

- Update the PRD counts and remove claims contradicted by current source.
- Define Core, Optional, and Labs capability tiers.
- Add an automated drift check for documented command/tool counts where useful.
- Decide and document release-mode bridge behavior.

**Exit gate:** PRD, capability catalog, package manifests, and source agree on
product scope and security behavior.

### Phase 1: Make the product installable

**Objective:** A new user can install all core packages from public registries.

- Remove the Design QA path dependency from the base bridge.
- Publish Dart packages in dependency order and add dry-run gates.
- Add npm release automation and provenance.
- Add complete npm metadata, package READMEs, LICENSE files, and `files` allowlists.
- Align generated Vitest dependencies with one supported stable version.
- Test `npm`, `pnpm`, and one of `yarn` or `bun` in clean temporary consumers.

**Exit gate:** Registry-only installation succeeds in a clean Flutter sample;
all package publish dry-runs are clean.

### Phase 2: Prove the core journey

**Objective:** Protect the real user path, not only package internals.

- Add a hermetic Flutter app smoke test to CI.
- Run `fliwright init`, launch the generated target, discover the VM Service,
  execute the generated test, and validate artifacts.
- Cover one primary desktop/mobile CI platform and document the rest of the
  support matrix.
- Ensure the Bridge is unavailable or inert in release builds.

**Exit gate:** The three-command happy path passes in CI from a clean checkout.

### Phase 3: Consolidate CLI and MCP

**Objective:** Establish one application contract with multiple adapters.

- Extract shared application use cases from CLI and MCP orchestration.
- Add versioned CLI JSON/NDJSON schemas and contract tests.
- Fill CLI gaps for operations currently available only through MCP.
- Consolidate the MCP default profile into intent-level tools.
- Move read-only retrieval operations to MCP resources where appropriate.
- Add parity tests mapping every MCP mutation to a shared use case and CLI
  operation.

**Exit gate:** CLI works without MCP; MCP contains no independent domain
behavior; default agent tool selection remains small and unambiguous.

### Phase 4: Developer Preview

**Objective:** Validate the product outside its repository and author team.

- Publish versioned Quick Start, troubleshooting, compatibility, migration,
  and security documentation.
- Test against at least three external Flutter applications, including one
  non-Riverpod application and one application with an existing E2E suite.
- Measure setup time, first-test success, flaky rerun rate, and diagnostic value.
- Mark Labs surfaces clearly and keep them out of the default onboarding.

**Exit gate:** At least three external consumers complete installation and a
  useful test without repository-local dependencies or author intervention.

### Phase 5: Stable release

**Objective:** Commit to compatibility and upgrade behavior.

- Publish a protocol/version compatibility policy.
- Support at least two declared Flutter stable versions or document a strict
  single-version policy with automated upgrade cadence.
- Add migration tests and changelog discipline across Dart, npm, and VS Code.
- Define deprecation periods for CLI commands, JSON schemas, MCP tools, and VM
  Service protocol methods.

## 7. Success metrics

### Activation

- Median time from install to first passing test: under 10 minutes.
- Clean-sample setup success rate: at least 90% without manual VM URL copying.

### Reliability

- Core smoke pass rate across supported Flutter versions: at least 99%.
- No unexplained flaky rerun in the release gate.
- Failure artifacts produced for at least 95% of actionable E2E failures.

### Surface quality

- Default MCP profile: no more than ten tools.
- One documented CLI equivalent for every mutable MCP capability.
- No required core dependency on Labs packages.

### External validation

- Three external applications before Developer Preview promotion.
- Ten external applications and two Flutter upgrade cycles before stable 1.0.

## 8. Immediate work order

1. Split Design QA out of `fliwright_bridge` and fix Dart publication.
2. Fix the Vitest version contradiction in `fliwright init`.
3. Add npm package metadata, tarball tests, and release automation.
4. Add a registry-only generated-project smoke test.
5. Add a live Flutter E2E CI smoke path.
6. Refresh the PRD and public Quick Start.
7. Extract shared application use cases and fill CLI parity gaps.
8. Consolidate the default MCP surface while preserving specialist profiles.

Items 1–6 are release blockers. Items 7–8 are the product-surface improvement
that should land before promoting the preview to a general public beta.
