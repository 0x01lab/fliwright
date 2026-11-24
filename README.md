# Fliwright

> Developer Preview — Playwright-style white-box E2E testing for Flutter.

Fliwright runs TypeScript tests against a trusted Flutter debug or test build.
An in-app Dart bridge exposes widget semantics, actions, screenshots, network
mocks, state reset, and diagnostics through the Dart VM Service. Developers
and CI use the CLI to drive the same runtime as the Vitest and VS Code adapters.

## Quick Start

Start in a Flutter project whose source you control. You need Flutter 3.x with
Dart 3.5 or later and a supported Node.js version (22.x starting at 22.12, 24.x,
or 26 and later).

For Codex, initialize the Flutter project and install its Agent Skills in one
command (requires the corresponding CLI and bridge versions to be published):

```sh
npx --yes --package=@fliwright/cli@latest fliwright init --agent codex --yes
```

Open a new Codex chat in the project after initialization. Setup preserves
existing project rules and reports any remaining configuration. The
[Codex integration guide (in Chinese)](docs/codex-integration.md) covers plugin
and skill installation, Flutter project setup, and a sample `AGENTS.md`.

For manual setup, install the test dependencies and initialize the project.

```sh
npm install --save-dev @fliwright/cli @fliwright/vitest vitest@5.0.5 typescript
npx fliwright init
```

After either setup, launch the instrumented app.

```sh
flutter run -t test_driver/fliwright_app.dart
```

Leave the app running and run the tests from a second terminal in the project.

```sh
npx fliwright run
```

The generated example uses the following test shape:

```ts
import { expect, test } from '@fliwright/vitest';

test('increments the counter', async ({ page }) => {
  await page.locator('text=Increment').click();
  await expect(page.locator('text=Count: 1')).toBeVisible();
});
```

Run `npx fliwright doctor` when the Flutter VM Service cannot be discovered or
the bridge does not report its capabilities.

## Artifact Storage

Run history defaults to `.fliwright/runs/` inside the project. Reusable healing
state and temporary inspection captures use `.fliwright/cache/`. Configure both
in `fliwright.config.ts`; relative paths resolve from that file's project root:

```ts
import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  runsRoot: '.fliwright/runs',
  cacheRoot: '.fliwright/cache',
});
```

These fields are optional. `--runs-root` overrides `FLIWRIGHT_RUNS_ROOT`, which
overrides the project setting. CLI, the Vitest preset, TDD and VS Code use the
same resolved paths. Runs own their attempts' screenshots, snapshots, logs,
Trace and AI records; temporary screenshots use unique files in `cache/inspect`.
Ignore generated runs/cache contents in Git, keeping authored tests and mocks.
Existing home-directory history is preserved; switching defaults does not move
or delete it. Use `fliwright artifacts export` to save a portable report.

## Product Surface

- **Core:** locator/action/assertion/wait, screenshots, timelines, failure
  artifacts, deterministic scenarios, CLI, and Vitest.
- **Optional:** HTTP/WebSocket mocks, Riverpod adapter, VS Code.
- **Labs:** persistent TDD, AI repair, flow/Figma review, and Design QA.

The independent [`gitlab-test-plan` Skill](.agents/skills/gitlab-test-plan/SKILL.md)
turns GitLab acceptance checklists into traceable test cases; when no checklist
exists, it derives cases from requirements. Its [test-plan helpers](packages/test-plan/README.md)
fetch and validate data without an AI subprocess or core runtime dependency.

Coding agents use the bundled Skills and CLI; CI uses finite commands and exit codes.
Deterministic automation should be expressed through the CLI and versioned
machine-readable reports.

## Security and Compatibility

`fliwright_bridge` is intended only for trusted debug and test builds. Its
initializers are inert in Flutter release mode; keep it in a separate test
entrypoint so release tree shaking can remove the package.

The Developer Preview currently targets Node.js 22.12+ (22.x), 24.x, or 26+, Dart 3.5+, and locally
reachable Flutter VM Service sessions. Android, iOS, macOS, Windows, Linux, and
Web are not all release-gated yet; only platforms listed in the release notes
should be considered verified.

## Packages

- `@fliwright/devices` discovers local iOS and Android devices, simulators, and emulators. List them with `fliwright devices list --json`.
- `fliwright_bridge`: minimal Flutter instrumentation.
- `@fliwright/core`: shared automation runtime.
- `@fliwright/vitest`: test fixtures and lifecycle.
- `@fliwright/cli`: primary command-line interface.
- `fliwright_bridge_riverpod` / `@fliwright/plugin-riverpod`: optional Riverpod integration.
- `fliwright_design_qa` and `@fliwright/tdd`: Labs packages.

Detailed implemented behavior is indexed under [`docs/features`](docs/features/index.md).
Product direction and release gates are in the
[`product surface and release strategy`](docs/superpowers/specs/2026-09-15-product-surface-and-release-strategy.md).
Compatibility claims and common setup failures are documented in
[`compatibility`](docs/release/compatibility.md) and
[`troubleshooting`](docs/release/troubleshooting.md). Before upgrading an
earlier pre-release setup, also read the [`migration guide`](docs/release/migration.md)
and [`security model`](docs/release/security.md).

## Development

```sh
pnpm install
pnpm lint
pnpm test
pnpm build
pnpm package:check
node scripts/verify-harness.mjs
```

Real E2E smoke tests additionally require a running Flutter VM Service.

### Cloud Deployment

The [`@fliwright/cloud` server](packages/fliwright-cloud/README.md) manages the
run queue, hosts the device management page, and serves reports. On each
machine that hosts devices, run the standalone
[`@fliwright/cloud-worker` CLI](packages/fliwright-cloud-worker/README.md).
Each worker stays connected to the same server and uses `@fliwright/devices`
to discover physical iOS and Android devices, iOS simulators, and Android
emulators. Workers and the server communicate using `@fliwright/cloud-protocol`.
