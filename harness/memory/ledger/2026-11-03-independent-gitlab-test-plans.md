# Keep GitLab test planning independent from automation execution

- Status: accepted
- Date: 2026-11-03
- Scope: independent test-plan tool and CLI release reports
- Evidence: `packages/test-plan/tests/test-plan.test.ts`, `packages/test-plan/tests/process-cli.test.ts`, `packages/fliwright-cli/tests/artifact-report.test.ts`
- Changed-Files: `scripts/sync-codex-plugin-skills.mjs`, `scripts/check-codex-plugin.mjs`, `package.json`, `packages/test-plan/package.json`, `packages/test-plan/tsconfig.json`, `packages/test-plan/src/schema.ts`, `packages/test-plan/src/process.ts`, `packages/test-plan/src/cli.ts`, `packages/test-plan/src/GitLab.ts`, `packages/test-plan/src/index.ts`, `packages/test-plan/src/Plan.ts`, `packages/fliwright-cli/src/HtmlReport.ts`, `packages/fliwright-cli/src/HtmlReportAssets.ts`, `packages/fliwright-cli/src/ReleaseReview.ts`, `packages/fliwright-cli/src/commands/artifact-report.ts`, `packages/fliwright-cli/src/commands/run.ts`, `packages/fliwright-cli/src/registry/finite.ts`, `packages/fliwright-cli/src/reporter.ts`, `packages/fliwright-cli/src/run.ts`
- Supersedes: none

## Decision

GitLab Work Item interpretation and structured case generation belong to the
`gitlab-test-plan` Skill in the current AI session. It prioritizes the Item
acceptance checklist and uses requirements only when no checklist exists. An
independent framework-neutral helper with no workspace runtime dependencies
fetches snapshots, assembles/validates skill-authored drafts and records bindings.
It must not start an AI provider subprocess. Acceptance standards preserve
verbatim source quotes and case references; uncovered standards block release. Preserve Item
identity, description and paginated non-system comments as a dated source
snapshot. Generated cases have content-derived IDs and no execution verdict.
Bindings connect IDs to project-relative test files and full runner titles.
Regeneration writes a new plan; changed case content must not silently retain an
old binding.

Reports consume the versioned JSON plan rather than importing or invoking the
planner. The release manifest declares run identity and release metadata and
references the plan relative to its own directory. Test qualification requires
all declared cases to match unique passed execution results and complete
evidence. Missing bindings, missing cases, unresolved requirements, unlinked
executed tests and inconsistent summaries block qualification. A report may be
written for any outcome, with a separate opt-in CI exit gate. Qualification is
not human release approval or verification of the binary's provenance.

Keep report rendering separate from qualification. An absent version, build or
commit must not discard the plan or prevent its Item/case evidence from being
rendered. `artifacts report --plan` creates the review manifest automatically;
partial release metadata is valid input, while missing fields and metadata
conflicting with the real run remain explicit release blockers. Preserve supplied
conflicts in generated manifests so reopening them cannot silently erase a
blocker. `run --release` stores caller-declared tested-build identity in canonical
results and portable exports, including failed runs. Never infer installed-binary
identity from the current checkout or manufacture placeholders to qualify a run.
