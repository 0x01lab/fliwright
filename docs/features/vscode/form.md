---
module: "form"
package: "@fliwright/vscode"
source: "src/form/"
generated: "2026-06-02"
---

# Form

> Form rule editor + analyze/fill commands wired into the VS Code extension.

## Overview

`FormRuleService` manages the workspace's `fliwright.form-rules.json` file(s). `FormHelperService` wraps `@fliwright/core` `FormHelper` and exposes high-level commands for analyzing the current form (preview), filling it with no rules, and filling it with the active rule set applied.

## Modules

| File | Role |
|------|------|
| `src/form/FormRuleService.ts` | CRUD over form-rules JSON |
| `src/form/FormHelperService.ts` | Calls bridge `ext.fliwright.formExtract` + `type` to analyze/fill |

## Commands

| Command | Action |
|---------|--------|
| `fliwright.reloadFormRules` | Re-read rules and refresh the Form Data tree |
| `fliwright.createFormRules` | Create a `fliwright.form-rules.json` template |
| `fliwright.openFormRules` | Open the rules file in the editor |
| `fliwright.analyzeForm` | Run `FormHelper.analyze` and display proposed values |
| `fliwright.fillForm` | Run `FormHelper.fill()` (no rules) |
| `fliwright.fillFormWithRules` | Run `FormHelper.fill({ rulesFile })` |

## Exports

- `formatFormFillDebug(result: FormFillResult): string` — formats a result for the output channel.
- `formRulesFileName` — canonical file name (`fliwright.form-rules.json`).

## Related

- **Source:** `packages/fliwright-vscode/src/form/`
