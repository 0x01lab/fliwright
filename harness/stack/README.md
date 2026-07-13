# Approved Stack

[framework.json](./framework.json) is the machine-checked allowlist for direct
Node and Dart dependencies, their approved versions, Dart SDK constraints, and
required TypeScript compiler options.

To add or upgrade a dependency:

1. Confirm the owning capability in
   [../architecture/dependency-rules.json](../architecture/dependency-rules.json).
2. Update the relevant `package.json` or `pubspec.yaml` and the matching entry
   in `framework.json` in the same change.
3. Keep `pnpm-lock.yaml` as the only Node lockfile. Do not create package-level
   npm lockfiles.
4. Add or update a reviewed ledger entry, then run
   `node scripts/verify-harness.mjs`.

The allowlist is intentionally exact. A version range is permitted only when it
is the approved range recorded in `framework.json`; a package manifest cannot
silently widen or change it. This includes peer metadata, optional dependencies,
bundle dependencies, overrides, pnpm settings, and package engines.
