# Publishing Fliwright

This guide covers the public release paths for the Fliwright VS Code extension
and Flutter/Dart packages.

## Release assets

- VS Code Marketplace icon: `packages/fliwright-vscode/media/fliwright-marketplace.png`
- VS Code activity bar icon: `packages/fliwright-vscode/media/fliwright.svg`
- Regenerate the PNG icon with:

```bash
node packages/fliwright-vscode/scripts/generate-marketplace-icon.mjs
```

## VS Code Marketplace

The extension is published from `packages/fliwright-vscode`.

Before the first release:

1. Create or choose a Visual Studio Marketplace publisher named `fliwright`.
2. Create a Marketplace personal access token with extension publish access.
3. Add the token to GitHub Actions as `VSCE_PAT`.
4. Confirm `packages/fliwright-vscode/package.json` has the intended
   `publisher`, `displayName`, `description`, `categories`, `keywords`, `icon`,
   `repository`, `bugs`, and `homepage`.

The GitHub Actions workflow expects the repository to be hosted at
`0x01lab/fliwright`, the Marketplace publisher to be `fliwright`, and the
repository secret to be named `VSCE_PAT`. The token is never stored in the
repository. The workflow publishes only after the release tag exactly matches
the manifest version.

Manual package and publish:

```bash
pnpm --filter fliwright-vscode run lint
pnpm --filter fliwright-vscode run test
pnpm --filter fliwright-vscode run package
VSCE_PAT=... pnpm --filter fliwright-vscode run publish:vsce
```

Automated publish after updating the manifest version and changelog:

```bash
git tag vscode-v0.2.0
git push origin vscode-v0.2.0
```

The `release-vscode.yml` workflow validates the tag/version match, verifies the
Marketplace credential, runs lint, unit, and VS Code integration tests, packages
the VSIX, publishes it with `vsce`, and uploads the VSIX to the matching GitHub
release. It uses `xvfb` for the VS Code integration test on the Linux runner.

## pub.dev

Packages prepared for pub.dev:

- `packages/fliwright-bridge`
- `packages/fliwright-bridge-riverpod`

Publish order matters. Publish `fliwright_bridge` first, then
`fliwright_bridge_riverpod`, because the Riverpod adapter depends on
`fliwright_bridge: ^0.1.0`.

Before the first release:

1. Run a local dry run for each package:

```bash
cd packages/fliwright-bridge
dart pub publish --dry-run

cd ../fliwright-bridge-riverpod
dart pub publish --dry-run
```

2. Publish each package manually once:

```bash
cd packages/fliwright-bridge
dart pub publish

cd ../fliwright-bridge-riverpod
dart pub publish
```

3. In each package page on pub.dev, configure automated publishing for this
   GitHub repository and workflow: `.github/workflows/publish-pub.yml`.
   Use these tag patterns:

```text
fliwright_bridge-v{{version}}
fliwright_bridge_riverpod-v{{version}}
```

Automated publish tags:

```bash
git tag fliwright_bridge-v0.1.0
git push origin fliwright_bridge-v0.1.0

git tag fliwright_bridge_riverpod-v0.1.0
git push origin fliwright_bridge_riverpod-v0.1.0
```

The `publish-pub.yml` workflow is tag-only because pub.dev rejects automated
publishing from non-tag GitHub Actions events. It installs Flutter, uses GitHub
OIDC (`id-token: write`) for pub.dev, runs `flutter analyze .`, `flutter test`,
a dry run, and then `flutter pub publish --force`.

## Release copy

Short VS Code Marketplace description:

> Flutter automation, recording, mocks, traces, and Riverpod state tools for
> Fliwright.

Long introduction:

> Fliwright brings Flutter app automation into VS Code. Connect to a running
> Flutter VM Service, inspect devices, run TypeScript automation scripts and
> Vitest E2E tests, record interactions into editable tests, apply local API
> mock rules, preview failure context, browse traces, and inspect or override
> Riverpod providers through the Fliwright bridge.

pub.dev `fliwright_bridge` summary:

> Flutter VM Service bridge for Fliwright automation, widget inspection,
> gestures, screenshots, recording, and network mocks.

pub.dev `fliwright_bridge_riverpod` summary:

> Riverpod observer adapter for Fliwright state inspection, watching,
> serialization, and writable provider overrides.
