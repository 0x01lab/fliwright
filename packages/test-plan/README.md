# GitLab test plan helpers

`@fliwright/test-plan` is an independent deterministic package for GitLab snapshots,
source-backed acceptance plans, collected-test bindings and derived coverage views.
The [`gitlab-test-plan` Skill](../../.agents/skills/gitlab-test-plan/SKILL.md) interprets
requirements in the current AI session. This package does not invoke AI, run tests,
load Flutter state or approve releases.

```text
$gitlab-test-plan 根据这个 Item 完成测试计划、Fliwright 脚本、绑定、执行验证和发版审核 HTML 报告：<Item URL>
```

Plan-only and report-only requests remain supported. Acceptance checklists take
priority, including checked entries; requirements are used when no checklist exists.
Every criterion retains an original quote and maps to cases or explicit questions.

## Persistent files

```text
.fliwright/test-plans/<iid>/
  plan.json       # Original sources + criteria + cases + current automation bindings
  coverage.md     # Regenerated from plan.json
  scenarios.ts    # Only when needed by scripts
  mocks/api/      # Only Item-specific responses
  design/         # Only baselines actually used by tests
```

Tests live in `.fliwright/tests/*.test.ts`, reusable helpers in `.fliwright/support/`.
Snapshot, draft, update and catalog inputs are temporary. Do not keep multiple
bound/final plan copies or duplicate run JSON, JUnit and command envelopes here.
Run evidence stays in the configured runs root; release reports go beside the
selected run's evidence. The Skill handles report generation through Fliwright CLI.

## Compact workflow

Prerequisites: Node.js 20+, `glab` authenticated for the selected GitLab host, and
GraphQL Work Item support. Fetch preserves all non-system comments and their source
times, supports project/group Work Item URLs, and never writes to GitLab.

```sh
pnpm --filter @fliwright/test-plan build
task_tmp=$(mktemp -d)
test-plan fetch https://gitlab.example.com/team/app/-/work_items/128 \
  --output "$task_tmp/snapshot.json"

# Supply the real draft JSON on stdin (e.g. through a quoted heredoc).
test-plan assemble --snapshot "$task_tmp/snapshot.json" --draft - \
  --output .fliwright/test-plans/128/plan.json
test-plan validate .fliwright/test-plans/128/plan.json

fliwright catalog --json > "$task_tmp/catalog.json"
# Supply verified coverage decisions on stdin.
test-plan update .fliwright/test-plans/128/plan.json \
  --updates - --catalog "$task_tmp/catalog.json"
test-plan validate .fliwright/test-plans/128/plan.json \
  --catalog "$task_tmp/catalog.json" --require-scripts
test-plan coverage .fliwright/test-plans/128/plan.json
```

Full draft and batch-update schemas are in the [data contract](../../.agents/skills/gitlab-test-plan/references/workflow.md).
`assemble --snapshot -`, `--draft -`, `update --updates -` and `--catalog -` accept
stdin. Only one JSON input per command may use stdin; other inputs can be temporary
files. Clean up this task's temporary directory after successful completion. Failed
inputs can be retained there for correction, without creating Item-directory history.

`update` and `bind` default to atomically updating the input plan after all changes,
source references and catalog identities validate. Invalid batches, cancellation,
concurrent writers or a changed original leave the original plan intact. Replacement
refuses symlinks. A sibling lock coordinates writers; confirm its owner has stopped
before manually removing a lock left by an interrupted process. `--output <new-path>`
requests a separate export and never overwrites an existing file. Fetch and initial
assembly also require new output files. Re-authored requirements must first be
assembled separately and reviewed; changed case identities cannot inherit bindings.

Single-case binding also updates the canonical plan:

```sh
test-plan bind .fliwright/test-plans/128/plan.json GL-128-ACTUAL_ID \
  --catalog "$task_tmp/catalog.json" --file .fliwright/tests/checkout.test.ts \
  --name 'checkout applies coupon'
```

## Coverage and execution

Plans use schema version 2; source snapshots use version 1. The complete original
source is embedded in the plan, so removing temporary snapshots loses no provenance.

| automation.status | Meaning | Required data |
| --- | --- | --- |
| pending | Script work remains | Optional reason |
| partial | Only part of the planned behavior is covered | Specific missing assertions and supporting file/name references |
| blocked | Requirements or environment prevent progress | Specific reason; optional supporting tests |
| complete | The Skill verified full script coverage | Unique file/full test name binding |

Catalog checks collected identities, not assertion semantics. `validate --require-scripts`
exits 1 for incomplete coverage, missing/ambiguous catalog references, uncovered criteria,
open questions or an empty plan. `valid: true` alone only means structurally valid.
Neither `complete` nor `scriptsReady` proves a passed execution.

`coverage` regenerates the single `coverage.md` beside the plan. It includes Item sources,
original criterion quotes, case mappings, script locations, status, gaps and questions.
`--output -` prints Markdown without writing; `--output <path>` selects another derived
view location. Coverage cannot replace the source plan. Regenerate after binding changes;
do not hand-maintain a second set of facts or insert run pass rates into this view.

See the [script workflow](../../.agents/skills/gitlab-test-plan/references/fliwright-scripts.md)
and [release-report workflow](../../.agents/skills/gitlab-test-plan/references/release-review.md)
for execution and reports. Missing runtime or build identity remains explicit; failed
execution and incomplete coverage block qualification even when a report can be generated.
