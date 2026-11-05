# Publishing Fliwright

This guide covers the public release paths for the Fliwright npm packages,
Flutter/Dart packages, VS Code extension, and Codex plugin.

## Required release gate

All four tag workflows call `release-gate.yml`, which requires the tagged commit
in `main` history and reruns the complete CI on that exact commit before allowing
publication. CI includes Harness checks, Node 26 public-package and extension build/lint/tests,
public-package compatibility on Node 22/24, Flutter tests, Android and unsigned iOS
compilation and generated Flutter E2E.
Cloud server, worker and protocol delivery are outside this public release gate.
Package suites run sequentially with at most two Vitest workers to avoid CPU/filesystem contention in timing tests.

The aggregate `CI quality gate` fails if any required job fails, is cancelled or
is skipped. Apply the reviewed main protection configuration with:

```sh
gh api --method PUT repos/0x01lab/fliwright/branches/main/protection \
  --input .github/branch-protection.json
```

This requires an up-to-date passing gate through a PR, also for administrators,
and blocks force pushes and branch deletion. No human approval count is imposed.
Changing these repository settings requires repository admin access.

Use the pinned Flutter version from CI and Node 26 for release builds. The
reviewed Android generated-host AGP/Kotlin versions live in
`harness/stack/framework.json` under `ciToolchains`; update them together with
mobile compilation validation.

## One-command project setup

The main community onboarding command is:

```sh
npx --yes --package=@fliwright/cli@latest fliwright init --agent codex --yes
```

Publish the complete CLI runtime dependency graph, the matching Vitest package
and Flutter bridge before advertising it as available. Build the CLI with its
bundled Skills (`dist/skills`); do not publish a TypeScript-only build without
these resources. Regenerate command references before the final package build.
Verify `tests/init-package.test.ts` against an extracted tarball, then verify an
actual clean npm install after publication. The local package test supplies
runtime dependencies and stubs dependency installers; it proves packaged Skill
availability and the JSON contract, not public registry availability or App
build success. The command installs project-local Skills; it does not depend on
Codex being separately installed or register a marketplace on the user's behalf.

## Codex community plugin

The community plugin is distributed from the public GitHub repository at
`https://github.com/0x01lab/fliwright.git`. The marketplace is named `fliwright`;
its plugin entry uses `git-subdir` to fetch `./plugins/fliwright` from `main`.
Users register the Git URL and install `fliwright@fliwright`, without a local
Fliwright checkout. See the [integration guide](../codex-integration.md).

Before publishing an update:

1. Update the source Skills under `.agents/skills/`, then run `pnpm plugin:sync`.
2. Bump `plugins/fliwright/.codex-plugin/plugin.json` to a new plugin version.
3. Run `node scripts/check-codex-plugin.mjs --skip-cli` and check the bundled
   [smoke prompts](../../plugins/fliwright/test-cases.md) for affected workflows.
4. Include `.agents/plugins/marketplace.json`, the plugin manifest, and all
   referenced plugin Skills/resources in the reviewed change published to
   public `main`. Unpublished workspace edits are not remotely installable.
5. After the change reaches `main`, push a tag whose suffix exactly matches the
   plugin manifest version. The `release-codex-plugin.yml` workflow reruns the
   release gate, validates the plugin bundle and tag/version match, then creates
   a GitHub Release with generated notes, a plugin `.tar.gz` bundle and its
   `.sha256` checksum. Versions such as `1.2.3-rc.1` create a prerelease;
   build metadata such as `+codex.20261105` does not:

   ```bash
   git tag codex-v0.1.0+codex.20260712075300
   git push origin codex-v0.1.0+codex.20260712075300
   ```

6. From a clean Codex environment, register and install the public source:

   ```sh
   codex plugin marketplace add https://github.com/0x01lab/fliwright.git --ref main
   codex plugin add fliwright@fliwright
   ```

The marketplace source currently points to `main`, so users receive updates
from reviewed changes on `main`; the release tag records and gates a versioned
release but does not pin marketplace installs to that tag. To install a fixed
version, pin the marketplace source and plugin entry to the intended tag or
commit SHA.

The Codex release workflow uses Node 26 and the repository's built-in plugin
checks, including bundled Skill/source consistency. It needs no npm token or
Marketplace publishing secret: GitHub Release creation uses the automatic
`GITHUB_TOKEN` with `contents: write` scoped to the publish job. Install the
workflow on `main` before pushing the first `codex-v*` tag.

The archive contains the plugin root, including `.codex-plugin/plugin.json`,
Skills and resources. The same files are retained as a workflow artifact before
Release creation, so a failed Release upload can be retried by rerunning the
workflow. To verify a downloaded bundle, run `shasum -a 256 -c <bundle>.sha256`
in the download directory. Git marketplace installation continues to use the
repository ref; the downloadable archive does not change that installation path.

Existing users refresh the source with `codex plugin marketplace upgrade fliwright`
and reinstall with `codex plugin add fliwright@fliwright`, then start a new chat.
Keep the plugin version distinct for each published change so installations can
pick up the new bundle. For a versioned distribution, pin both the marketplace
source and its plugin entry to the intended published ref or SHA.

Publish the Node and Dart dependencies separately using the procedures below;
the plugin bundles instructions and resources, not the target App's runtime.
Distribution from a GitHub marketplace is separate from listing in the universal
OpenAI plugin directory. To offer public-directory discovery, follow the
[official submission process](https://developers.openai.com/plugins/deploy/submission).

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

The public TypeScript packages are published by `.github/workflows/publish-npm.yml`
from a matching `npm-v<version>` tag. Public scoped packages are discovered from manifests and ordered by workspace runtime/peer dependencies; native is included automatically. The workflow verifies that all public
package versions match, builds workspace dependencies before lint and tests, runs tarball checks and clean npm/pnpm
consumer imports, publishes in dependency order with npm provenance, and then
installs the exact published versions from the npm registry in a retrying clean
consumer smoke test. The publish step skips an exact package/version that is
already present, so rerunning a failed tag workflow is safe after a partial
publish.

Configure npm publishing before the first tag: either add this repository and
`publish-npm.yml` as a Trusted Publisher for every public package on npm, or
provide the repository Actions secret `NPM_TOKEN` with publication access to the
complete package graph. Package versions already on the registry are immutable.
The initial pub.dev publication and OIDC configuration are described above;
VS Code requires the separate Marketplace Trusted Publishing policy.

Before tagging, run:

```bash
pnpm build
pnpm lint
pnpm --workspace-concurrency=1 --filter './packages/*' --filter '!@fliwright/cloud*' -r run test --maxWorkers=2
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
