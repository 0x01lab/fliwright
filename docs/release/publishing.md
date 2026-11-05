# Publishing Fliwright

This guide covers the public release paths for the Fliwright npm packages,
Flutter/Dart packages, VS Code extension, and Codex plugin.

## Codex plugin

The `release-codex-plugin.yml` workflow publishes the plugin bundle from
`plugins/fliwright` when a `codex-v<version>` tag is pushed. The tag suffix must
exactly match `plugins/fliwright/.codex-plugin/plugin.json`.

Before releasing:

1. Update the canonical Skills in `.agents/skills`, then run `pnpm plugin:sync`.
2. Bump the plugin manifest to a distinct version for each published change.
3. Run `node --test scripts/tests/release-codex-plugin.test.mjs` and
   `node scripts/check-codex-plugin.mjs --strict-plugin --skip-cli`.
4. Merge the workflow, release scripts and plugin bundle into `main`.
5. On that reviewed commit, push the matching release tag:

   ```bash
   version=$(node -p "require('./plugins/fliwright/.codex-plugin/plugin.json').version")
   git tag "codex-v${version}"
   git push origin "codex-v${version}"
   ```

The shared `release-gate.yml` requires the tagged commit in `main` history and
reruns the complete CI on that commit. After it succeeds, the publish job uses
Node 26, runs release-tooling tests, validates the manifest and bundled
Skill/source consistency, and packages the plugin root including its hidden
`.codex-plugin/plugin.json`, Skills and resources.

The workflow creates a GitHub Release with generated notes, a plugin `.tar.gz`
bundle and its `.sha256` checksum. Versions such as `1.2.3-rc.1` create a
prerelease; build metadata such as `+codex.20261105` does not. The files are also
retained as a workflow artifact before Release creation. A failed Release upload
can be retried by rerunning the workflow.

To verify a downloaded archive, run `shasum -a 256 -c <bundle>.sha256` in its
download directory. The workflow uses the automatic `GITHUB_TOKEN` with
`contents: write` scoped to the publish job; no additional publishing secret is
needed. Marketplace installation follows the configured marketplace source ref;
creating a Release does not change that source ref or submit a directory listing.

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
2. In the publisher's Marketplace management page, add a Trusted Publishing
   policy for GitHub owner `0x01lab`, repository `fliwright`, and workflow
   `release-vscode.yml` (with no GitHub environment).
3. Confirm `packages/fliwright-vscode/package.json` has the intended
   `publisher`, `displayName`, `description`, `categories`, `keywords`, `icon`,
   `repository`, `bugs`, and `homepage`.

The GitHub Actions workflow expects the repository to be hosted at
`0x01lab/fliwright` and the Marketplace publisher to be `fliwright`. Its publish
job requests a GitHub OIDC token with `id-token: write`, which Marketplace
exchanges under that Trusted Publishing policy. No `VSCE_PAT` secret is needed.
The workflow publishes only after the release tag exactly matches the manifest
version. Configure the Marketplace policy before pushing the first tag.

Manual release verification:

```bash
pnpm --filter fliwright-vscode... build
pnpm --filter fliwright-vscode run lint
pnpm --filter fliwright-vscode run test
pnpm --filter fliwright-vscode run package
pnpm --filter fliwright-vscode run test:vsix
```

After merging the workflow, manifest version, and changelog into `main`, create
the tag on that reviewed commit to publish through GitHub Actions:

```bash
git tag vscode-v0.2.0
git push origin vscode-v0.2.0
```

The `release-vscode.yml` workflow validates the tag/version match, builds the
extension and its workspace dependencies, runs lint and unit tests, then tests
both the development extension and the installed VSIX under VS Code. It publishes
with `vsce --oidc` and uploads the VSIX to the matching GitHub release. It checks
whether the exact version already exists in Marketplace, so retrying a failed
GitHub asset upload does not republish that version. Both VS Code tests use
`xvfb` on the Linux runner. After the first tag run, verify the Marketplace
listing and the GitHub release asset.

## pub.dev

Packages prepared for pub.dev:

- `packages/fliwright-bridge`
- `packages/fliwright-bridge-riverpod`
- `packages/fliwright-design-qa` (Labs; published independently)

Publish order matters. Publish `fliwright_bridge` first, then
`fliwright_bridge_riverpod` and `fliwright_design_qa`, because both optional
packages depend on `fliwright_bridge: ^0.1.0`.

Before the first release:

1. Run a local dry run for each package:

```bash
cd packages/fliwright-bridge
dart pub publish --dry-run

cd ../fliwright-bridge-riverpod
dart pub publish --dry-run

cd ../fliwright-design-qa
dart pub publish --dry-run
```

2. Publish each package manually once:

```bash
cd packages/fliwright-bridge
dart pub publish

cd ../fliwright-bridge-riverpod
dart pub publish

cd ../fliwright-design-qa
dart pub publish
```

3. In each package page on pub.dev, configure automated publishing for this
   GitHub repository and workflow: `.github/workflows/publish-pub.yml`.
   Use these tag patterns:

```text
fliwright_bridge-v{{version}}
fliwright_bridge_riverpod-v{{version}}
fliwright_design_qa-v{{version}}
```

Automated publish tags:

```bash
git tag fliwright_bridge-v0.1.0
git push origin fliwright_bridge-v0.1.0

git tag fliwright_bridge_riverpod-v0.1.0
git push origin fliwright_bridge_riverpod-v0.1.0

git tag fliwright_design_qa-v0.1.0
git push origin fliwright_design_qa-v0.1.0
```

The `publish-pub.yml` workflow is tag-only because pub.dev rejects automated
publishing from non-tag GitHub Actions events. It installs Flutter, uses GitHub
OIDC (`id-token: write`) for pub.dev, runs `flutter analyze .`, `flutter test`,
a dry run, and then `flutter pub publish --force`.

## npm

Push `npm-v<version>` only after the release changes are merged to main. The npm
workflow verifies main ancestry and reruns all CI jobs through the reusable
release gate. It builds packages before lint/tests, checks tarballs, publishes
in dependency order, then installs the exact versions in a clean npm consumer.
The `CI quality gate` aggregates every required job and rejects failures or
skipped jobs. Package tests run sequentially with two workers for stable timing.


The public TypeScript packages are published by `.github/workflows/publish-npm.yml`
from a matching `npm-v<version>` tag. The workflow verifies that all six public
package versions match, runs lint, tests, builds, tarball checks, clean npm/pnpm
consumer imports, publishes in dependency order with npm provenance, and then
installs the exact published versions from the npm registry in a retrying clean
consumer smoke test. The publish step skips an exact package/version that is
already present, so rerunning a failed tag workflow is safe after a partial
publish.

Before tagging, run:

```bash
pnpm lint
pnpm test
pnpm build
pnpm package:check
```

The CLI and bundled Skills are the agent and CI install surface. The MCP package is no longer built or published.

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
