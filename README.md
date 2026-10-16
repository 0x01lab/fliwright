# Fliwright

> Developer Preview — Playwright-style white-box E2E testing for Flutter.

Fliwright runs TypeScript tests against a trusted Flutter debug or test build.
An in-app Dart bridge exposes Widget semantics, actions, screenshots, network
mocks, state reset, and diagnostics through the Dart VM Service. The CLI is the
primary user and CI interface; Vitest, VS Code, and MCP are adapters over the
same runtime.

## Quick Start

Requirements: Node.js 20 or newer, Flutter 3.x with Dart 3.5 or newer, and a
Flutter project whose source you control.

```sh
npm install --save-dev @fliwright/cli @fliwright/vitest vitest@4.1.11 typescript
npx fliwright init
flutter run -t test_driver/fliwright_app.dart
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

## Product Surface

- **Core:** locator/action/assertion/wait, screenshots, timelines, failure
  artifacts, deterministic scenarios, CLI, and Vitest.
- **Optional:** HTTP/WebSocket mocks, Riverpod adapter, VS Code, and MCP.
- **Labs:** persistent TDD, AI repair, flow/Figma review, and Design QA.

MCP is an optional agent adapter, not a prerequisite for local or CI tests.
Deterministic automation should be expressed through the CLI and versioned
machine-readable reports.

## Security and Compatibility

`fliwright_bridge` is intended only for trusted debug and test builds. Its
initializers are inert in Flutter release mode; keep it in a separate test
entrypoint so release tree shaking can remove the package.

The Developer Preview currently targets Node.js 20+, Dart 3.5+, and locally
reachable Flutter VM Service sessions. Android, iOS, macOS, Windows, Linux, and
Web are not all release-gated yet; only platforms listed in the release notes
should be considered verified.

## Packages

- `fliwright_bridge`: minimal Flutter instrumentation.
- `@fliwright/core`: shared automation runtime.
- `@fliwright/vitest`: test fixtures and lifecycle.
- `@fliwright/cli`: primary command-line interface.
- `@fliwright/mcp`: optional coding-agent adapter.
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
