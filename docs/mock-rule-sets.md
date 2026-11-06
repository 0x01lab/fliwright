# Shared and Item mock rule sets

Keep reusable endpoint responses in `.fliwright/mocks/api/`. Keep an Item's
reproduction and boundary responses in `.fliwright/test-plans/<iid>/mocks/api/`.
Both locations use the existing version 1 endpoint JSON format (`baseRule`,
`rules`, `removeBodyFields`). Item files do not need to be registered in the
project's shared `mock-index.json`.

“Shared” means reusable within the project. It does not mean all shared responses
are automatically enabled. One Item can reuse shared files and select different
named responses for its cases without copying a directory per case.

| Workflow | Selection | Validation and activation |
| --- | --- | --- |
| `sources` + `rules` in a named scenario | Explicit source/method/endpoint/rule | Strict validation, only selected endpoints, once per attempt/retry |
| `loadRules()` + `switchRule()` | Directory defaults, then named switches | Loads directory defaults; individual invalid files may warn and be skipped |
| CLI `mock apply` | One named directory response | Manual route update; does not compose a rule set or reset an attempt |

## Declare sources and select responses

The following example assumes the named files and rules already exist in the
target App. Replace endpoint paths, auth presets and routes with that App's
actual contracts. Paths are resolved from the execution working directory;
run from the project root or supply absolute directories.

```typescript
import { defineConfig } from '@fliwright/cli';
import type { TestScenario } from '@fliwright/core';

const scenarios = {
  'home.baseline': {
    name: 'home.baseline',
    layers: [{
      kind: 'mocks',
      sources: [{
        name: 'shared',
        directory: '.fliwright/mocks',
        files: ['api/user.json', 'api/positions.json'],
      }],
      rules: [
        { source: 'shared', method: 'POST', endpoint: '/api/user/info', rule: 'success' },
        { source: 'shared', method: 'GET', endpoint: '/api/positions', rule: 'empty' },
      ],
    }],
  },
  'item-437.review': {
    name: 'item-437.review',
    extends: ['home.baseline'],
    layers: [
      {
        kind: 'mocks',
        sources: [{
          name: 'item-437',
          directory: '.fliwright/test-plans/437/mocks',
          files: ['api/user.json'],
        }],
        rules: [{
          source: 'item-437', method: 'POST', endpoint: '/api/user/info',
          rule: 'review', replace: true,
        }],
      },
      { kind: 'auth', state: 'authenticated' },
      { kind: 'navigation', route: '/home' },
    ],
    ready: [{ kind: 'auth', state: 'authenticated' }],
  },
} satisfies Record<string, TestScenario>;

export default defineConfig({ scenarios });
```

Use the project's existing Fliwright/Vitest preset and support fixture:

```typescript
import { test, expect } from '@fliwright/vitest';

test.scenario('item-437.review')('review account shows its status', async ({ page }) => {
  await expect(page.getByKey('account.reviewStatus'), 'Review status is visible').toBeVisible();
});
```

Scenario declarations can live beside `plan.json` in `scenarios.ts`; explicitly
import and register them in `fliwright.config.ts`. Discovery does not scan GitLab
Items or import every Item directory. Keep persistent test files under
`.fliwright/tests/` and bind their collected file/full name using `test-plan`.
The plan retains business preconditions and acceptance criteria; it does not
embed HTTP bodies or execute the Mock runtime.

## Validate before running

`fliwright scenario resolve <name> --json` resolves the declaration and checks
composition; it does not read endpoint JSON. Use exported core
`resolveMockRuleSet({ sources, rules })` to validate source files and selections
offline. Include all parent and child selections when validating replacements;
a child-only `replace: true` selection has no earlier response to replace.

Offline resolution returns response bodies for inspection. `applyRuleSet` returns
the smaller audit report described below. Neither offline resolution nor catalog
collection proves the App behavior passes acceptance.

## Resolution and isolation contract

- Source names must be unique in the resolved scenario. Child scenarios can
  select a parent's source without redeclaring it (`sources: []`).
- `files` is an explicit, non-empty list of paths relative to the source
  directory. There is no implicit scanning or use of index defaults.
- Only selected endpoints become active. A source's unselected endpoints and
  named rules remain inactive.
- A source cannot define the same method/path in two files, nor repeat a rule
  name within one file. GET and POST for the same path remain independent.
- Replacing an earlier method/path selection requires `replace: true`. Using it
  without an earlier selection is an error. Replacements select a complete
  response; they do not merge bodies from different sources. Within one endpoint
  file, `baseRule` keeps its existing shallow merge semantics.
- All declared files and selections are validated before the App is changed.
  Missing files, invalid JSON, missing rules/status and conflicts fail setup.
- Parent and child source layers resolve together and are applied once before
  storage, authentication and navigation. They cannot mix with directory/profile
  layers. Existing single-directory workflows remain available separately.
- Every selected scenario attempt, including retries, replaces **all** App Mock
  routes, clears request history and forgets the previous loaded rule catalog.
  This also replaces editor-applied routes. It requires the Flutter Mock bridge:
  there is no tool-server fallback.
- Unmatched requests are denied by default. An explicit
  `denyUnmatchedRequests: false` permits real network traffic; composed layers
  must agree if they explicitly specify this policy.
- The runtime verifies active route identities and attempts to clear partial
  routes on application failure. A failed application never reports success.

This prepares an explicitly selected scenario before an attempt. It does not
install automatic Mock setup for tests that do not select that scenario, nor
change the App's business data after a UI action. For a response transition
inside a test, apply another explicit rule set or register a strict
`mock.routeFlutter(...)` response before triggering the corresponding request.

## Runtime and audit metadata

For custom orchestration, `driver.mock.applyRuleSet({ sources, rules })` and the
timeline-aware `mock.applyRuleSet(...)` accept the same configuration. They return
`MockRuleSetReport`. `resolveMockRuleSet(...)` validates and resolves files without
connecting to the App and includes response bodies for inspection.

The report contains selected source names, directories, files, method/path,
rule names and SHA-256 file content hashes, plus a fingerprint of that provenance
and unmatched-request policy. It excludes response bodies. Vitest records it as
`mockRuleSet` on the scenario timeline node for each attempt; direct Mock runtime
calls record it as `ruleSet` on their Mock node. `scenarioFingerprint` continues
to identify the scenario declaration; `mockRuleSet.fingerprint` identifies the
resolved selected file contents. Keep the source files and Git revision with run
artifacts when exact response reconstruction is required.

Authentication still uses App-owned `auth.seedLoggedIn` / `auth.clearSession`.
Mock business responses such as KYC status and balances independently. Mocked
acceptance verifies client behavior against those responses; backend integration
requires separate verification.

## Migrate existing helpers

1. Identify shared endpoint responses and keep them in the project Mock library.
   Put only the Item's reproduction and boundary responses in its own directory.
   Keep complex data constructors in project support code when they are useful;
   source declarations currently read JSON and do not import TypeScript factories.
2. Declare explicit sources and selections. Compose parent baseline and child
   Item selections, using `replace: true` only where a method/path was selected
   earlier. Keep auth and navigation in their appropriate scenario layers.
3. Register the scenario and select it from each test. Remove redundant Mock
   clear/load initialization from helpers that would overwrite scenario setup;
   preserve business interactions and the original acceptance assertions.
4. Validate files offline, collect the actual tests, then execute against the
   App. Inspect the attempt's `mockRuleSet` in its timeline and retain the real
   result. A fresh run is needed after data changes; old evidence stays historical.

In `coverage.md`, link the plan case ID, collected file/full test name, scenario,
shared/Item source files and actual run/attempt. Resolve rule provenance from that
attempt's timeline instead of inferring historical responses from today's files.
Do not add Mock bodies or invented fields to the strict `plan.json` schema.

Update the corresponding Skill when changing this workflow:

- [write-fliwright-tests](../.agents/skills/write-fliwright-tests/SKILL.md) routes to
  the portable [rule-set reference](../.agents/skills/write-fliwright-tests/references/mock-rule-sets.md).
- [write-fliwright-mock-rules](../.agents/skills/write-fliwright-mock-rules/SKILL.md)
  owns endpoint JSON authoring and validation.
- [gitlab-test-plan](../.agents/skills/gitlab-test-plan/SKILL.md) connects acceptance
  criteria, script generation, binding and actual execution evidence.
