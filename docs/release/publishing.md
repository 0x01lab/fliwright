# Publishing Fliwright

This guide covers the public release paths for the Fliwright npm packages,
Flutter/Dart packages, and VS Code extension.

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

| Package | Directory | pub.dev tag pattern |
| --- | --- | --- |
| `fliwright_bridge` | `packages/fliwright-bridge` | `fliwright_bridge-v{{version}}` |
| `fliwright_bridge_riverpod` | `packages/fliwright-bridge-riverpod` | `fliwright_bridge_riverpod-v{{version}}` |
| `fliwright_design_qa` (Labs) | `packages/fliwright-design-qa` | `fliwright_design_qa-v{{version}}` |

Publish `fliwright_bridge` first. Both optional packages require a hosted bridge
version satisfying their `pubspec.yaml` constraint (currently `^0.1.0`). Their
local `pubspec_overrides.yaml` files are development conveniences and do not
make the dependency available to pub.dev consumers.

### First publication and authentication

[pub.dev requires the first version of each package to be published manually](https://dart.dev/tools/pub/automated-publishing).
Use a clean checkout of the intended main commit. For each package, run
`flutter pub get`, `flutter analyze .`, `flutter test`, and
`flutter pub publish --dry-run` before publishing. From the repository root:

```bash
(cd packages/fliwright-bridge && flutter pub publish)
```

Complete the browser authentication with the Google account that will own the
package. Wait for the bridge to be available, then check the dependent packages
against pub.dev without local path overrides before publishing them:

```bash
GITHUB_REF_NAME=fliwright_bridge_riverpod-v0.1.0 node scripts/pub-release.mjs check-dependencies
(cd packages/fliwright-bridge-riverpod && flutter pub publish)

GITHUB_REF_NAME=fliwright_design_qa-v0.1.0 node scripts/pub-release.mjs check-dependencies
(cd packages/fliwright-design-qa && flutter pub publish)
```

In **each package's Admin → Automated publishing** settings, enable GitHub
Actions publishing, set the repository to `0x01lab/fliwright`, and enter its
exact tag pattern from the table above. This requires uploader access to the
package or admin access to its verified publisher. No long-lived GitHub secret
is needed: `.github/workflows/publish-pub.yml` uses `dart-lang/setup-dart@v1`
and `id-token: write` to provision temporary OIDC credentials. `NPM_TOKEN`
does not authenticate pub.dev. If requiring a GitHub deployment environment
on pub.dev, configure the same `environment` on the publish job first.

### Subsequent releases and reruns

Update the package version and changelog, merge to main after CI passes, then
push its matching tag. For example, after changing the bridge to `0.1.1`:

```bash
git tag fliwright_bridge-v0.1.1 <merged-main-commit>
git push origin fliwright_bridge-v0.1.1
```

The workflow requires the tagged commit to belong to main history and reruns
the complete reusable release gate, including Flutter analysis/tests, package
dry runs and the Flutter E2E smoke. Only then can the publish job run. It:

1. Checks that tag, package name and manifest version agree, then queries the
   exact pub.dev version. Registry errors fail the job; only 404 means missing.
   A package that has never been published produces first-publication guidance.
2. For a missing version of an existing package, resolves the release manifest
   in a temporary directory with an isolated cache and no local overrides or
   lockfile. This blocks dependent releases until a compatible hosted bridge
   version exists. It then runs a dry run and `flutter pub publish --force`.
3. Installs the exact released version in a fresh Flutter consumer from
   `https://pub.dev`, using an isolated cache, analyzes the consumer, and runs
   a test importing the public entry point and referencing its public API.
   Installation retries up to ten times with fifteen-second delays to tolerate
   registry propagation. API analysis/test failures fail immediately.

Push dependent tags only after a required bridge release succeeds. Each tag is
an independent workflow run; pushing all tags together does not establish a
dependency order. Repeated runs of the same tag are serialized. An already
published exact version skips upload but still runs the full release gate and
consumer verification, so a run that failed after upload can be retried safely.
The same applies to tags for manually published first versions.

To rerun the public consumer check locally, without publishing anything:

```bash
GITHUB_REF_NAME=fliwright_bridge-v0.1.0 node scripts/pub-release.mjs verify
```

Release-tooling regression tests run in CI and can be run without Flutter:

```bash
node --test scripts/pub-release.test.mjs
```

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
