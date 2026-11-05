---
command: "artifacts.report"
group: artifacts
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright artifacts report

Generate an offline App release test review report grouped by GitLab Item.

## When to use

Use for human release review and a CI test-qualification gate.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- Omitting runId selects the newest run. output defaults to report.html inside that run. The destination must end in .html and must not already exist.
- review is a JSON file containing runId, release { app, version, build, commit, platform, environment }, and plan (path to a schemaVersion=2 test plan, relative to the review file). Use the gitlab-test-plan Skill to generate cases from the acceptance checklist (or requirements when absent). Its independent @fliwright/test-plan helpers fetch source snapshots, assemble/validate drafts and record bindings. Plan Items include basis, source, acceptanceCriteria, cases and openQuestions; each case references criterion IDs and declares automation.status: pending, partial, blocked or complete. Partial requires a reason and supporting tests; blocked requires a reason and may reference tests. Complete requires a binding; incomplete cases must not declare a complete binding. Case IDs and complete bindings must be unique. binding.name is the full Vitest suite-qualified title; binding.file is project-relative. The report consumes JSON only; it does not import or invoke the planner.
- plan is an alternative to review: pass an existing bound plan directly and the command saves a reusable <output-basename>.review.json with the selected runId, relative plan path and metadata recorded by run --release. review and plan are mutually exclusive. Existing HTML and review output files are never overwritten.
- With plan, optional release JSON supplies confirmed additional fields for the auto-created review. It requires plan; with review, put fields in that file instead. Saved run metadata takes precedence for display and conflicting values remain release blockers.
- Review release fields, or the entire release object, may be omitted when unknown. The command still displays Item links, every planned case and real execution evidence; absent metadata displays as not provided and blocks qualification. Provided fields must be nonempty strings. Canonical report.json metadata is reused; conflicts with review metadata block qualification and the saved run identity is displayed. No version/build/commit is inferred from the current checkout.
- The checklist declares the complete intended release scope. A case must match exactly one saved result by name and file. Pending, partially covered or blocked cases, missing/ambiguous results, unlinked, failed, skipped or interrupted tests block qualification. Unresolved openQuestions, missing/uncovered acceptance criteria and Items without cases also block qualification. Empty runs, incomplete or disabled evidence, expected-failure acceptance cases, runner errors, inconsistent summaries and mismatched runIds also block qualification. Retry history is retained; a final successful retry can qualify when all evidence is complete.
- Optional review.device contains verified historical device fields: id, name, model, platform (ios/android), kind (physical/simulator), osVersion. A saved report.json device snapshot takes precedence as a whole and is retained in auto-created review files. The overview metadata grid displays only the device model, with unrecorded models marked explicitly; there is no separate device section. Device metadata is informational and does not alter release qualification.
- The report presents release identity, device model in the overview, qualification blockers, GitLab Item title links, acceptance criteria, case descriptions, expected and actual test outcomes, and expandable execution evidence. Search, filters and screenshot enlargement work offline. Printing includes all cases regardless of screen filters.
- The report shows pending scripts, partial coverage, blockers and awaiting-execution states instead of an unbound label. Partial/blocked cases show their recorded reason and matching supporting test evidence; passing subsets cannot qualify the whole case. Without review or plan the report cannot qualify and has no Item/case mapping. The report links to each GitLab Item without embedding its description, comments or original-text quotations, including in search attributes. Full source snapshots remain in the plan for audit validation; report generation does not refresh GitLab. The reviewer must confirm requirement coverage, freshness, the tested binary and commit. Qualifying tests does not record human approval or publish an App.
- requireQualified=true writes the report first, then exits 1 with RELEASE_NOT_QUALIFIED and data when tests do not qualify. Without it, successful report generation exits 0 even when releaseReady=false. Use this gate as a prerequisite to the release job.
- Missing evidence requires allowPartial=true and remains prominently marked. A partial report never qualifies. No app connection or AI provider is used.
- Only attempt-owned PNG, JPEG, GIF and WebP files are embedded, including screenshots from passing tests. External URLs, path escapes and symlinks outside the attempt are rejected. Images are limited to 10 MiB each and 64 MiB total; omitted images are reported as missing evidence.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `runId` | `positional runId` | string | no | — | Saved run id; omission selects the latest available run where supported. (minLength=1) |
| `runsRoot` | `--runs-root` | string | no | — | Canonical run directory. Overrides config/FLIWRIGHT_RUNS_ROOT; default ~/.fliwright/<project-path>/runs. Relative paths use the project root. (minLength=1) |
| `allowPartial` | `--allow-partial` | boolean | no | — | Tolerate unreadable report JSON when a manifest exists; export also tolerates missing references and reports them. |
| `output` | `--output` | string | no | — | New self-contained .html file; defaults to report.html in the selected run. Existing files are never overwritten. (minLength=1) |
| `review` | `--review` | string | no | — | Existing review JSON with runId, relative plan path, optional release metadata and optional verified device snapshot (id/name/model/platform/kind/osVersion). Choose review or plan. (minLength=1) |
| `plan` | `--plan` | string | no | — | Existing test plan JSON. Automatically writes a reusable review manifest alongside HTML; missing release identity remains a blocker. Mutually exclusive with review. (minLength=1) |
| `release` | `--release` | object | no | — | Confirmed partial or complete release JSON for a direct plan. Requires plan; saved run identity is reused and conflicts block qualification. |
| `requireQualified` | `--require-qualified` | boolean | no | — | After generating the report, exit 1 if any release test qualification condition is unmet. Human approval remains separate. |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Generate a release review report

```sh
fliwright artifacts report 'RUN_ID' --review '.fliwright/release-review.json' --output 'artifacts/release-review.html' --json
```

### Create review metadata from a bound plan

```sh
fliwright artifacts report 'RUN_ID' --runs-root 'artifacts/runs' --plan '.fliwright/test-plans/128/plan.json' --output 'artifacts/release-review.html' --allow-partial 'true' --require-qualified 'true' --json
```

### Enforce test qualification before release

```sh
fliwright artifacts report 'RUN_ID' --runs-root 'artifacts/runs' --review '.fliwright/release-review.json' --output 'artifacts/release-review.html' --allow-partial 'true' --require-qualified 'true' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| runId / output | Selected run and generated HTML file. |
| reviewPath | Input review path, or the new <output-basename>.review.json automatically written alongside HTML when plan is supplied. |
| plannedCases / automatedCases | Planned acceptance cases and those with complete automation coverage; separate from executed tests. |
| tests | Number of executed test cases, excluding retry attempts. |
| partial | Whether execution evidence is incomplete; missing release identity is tracked separately. |
| missing | Missing, unreadable, rejected or oversized evidence references. |
| missingReleaseFields | Absent app/version/build/commit/platform/environment fields; each blocks qualification while the report is still generated. |
| releaseReady | All test qualification conditions hold; human release approval is still required. |
| blockers | Every condition preventing test qualification. |

## Effects and failure handling

Registry effects: `html-report`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "runId": {
      "type": "string",
      "minLength": 1
    },
    "runsRoot": {
      "type": "string",
      "minLength": 1
    },
    "allowPartial": {
      "type": "boolean"
    },
    "output": {
      "type": "string",
      "minLength": 1
    },
    "review": {
      "type": "string",
      "minLength": 1
    },
    "plan": {
      "type": "string",
      "minLength": 1
    },
    "release": {
      "type": "object",
      "properties": {
        "app": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "string",
          "minLength": 1
        },
        "build": {
          "type": "string",
          "minLength": 1
        },
        "commit": {
          "type": "string",
          "minLength": 1
        },
        "platform": {
          "type": "string",
          "minLength": 1
        },
        "environment": {
          "type": "string",
          "minLength": 1
        }
      },
      "additionalProperties": false
    },
    "requireQualified": {
      "type": "boolean"
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema artifacts.report --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [artifacts show](./command-artifacts.show.md) — Read a saved run report, manifest and the available run list.
- [artifacts export](./command-artifacts.export.md) — Export a saved run and its referenced evidence to a directory.
- [artifacts timeline](./command-artifacts.timeline.md) — Read a saved attempt timeline or inspect one node and its neighbors.
- [Command index](./index.md)
