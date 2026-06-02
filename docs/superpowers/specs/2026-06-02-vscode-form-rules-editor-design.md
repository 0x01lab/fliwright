# VS Code Single Form Rules File Visual Editor Design

**Date:** 2026-06-02
**Status:** Draft
**Scope:** Default visual editor for one `.fliwright/forms/<name>.json` file at a time in `packages/fliwright-vscode`
**Related docs:**
- `docs/superpowers/specs/2026-05-31-vscode-extension-design.md`
- `docs/superpowers/specs/2026-05-31-vscode-extension-ui-design.md`
- `docs/superpowers/specs/2026-05-30-slice6-form-helper-design.md`

---

## 1. Goal

Add a VS Code visual editor for a single Fliwright form data rule JSON file under `.fliwright/forms/<name>.json`.

When a user opens `.fliwright/forms/xxx.json`, VS Code should use this visual editor as the default editor for that file. The editor instance is bound only to the opened JSON document and edits that document's `rules` array. It is not a directory-wide editor for all form rule files.

The editor should let users inspect and edit the rules inside the currently opened file without manually writing JSON, while keeping that JSON file as the source of truth. It should support rule creation, rule editing, validation, reordering, duplication, deletion, and quick access to analyze/fill commands for the active file.

Non-goals:

- Do not introduce a separate persisted format.
- Do not replace the raw JSON editor. Users must still be able to open and edit JSON directly.
- Do not show or edit rules from other `.fliwright/forms/*.json` files in the same editor instance.
- Do not provide a directory-level rule manager in this slice.
- Do not move form-generation or fill behavior out of `@fliwright/core`.
- Do not send rule data, field names, generated values, or app metadata to network services.

---

## 2. Existing Context

Current extension support:

- `FormRuleService` discovers and validates `.fliwright/forms/*.json`.
- `FormDataTreeProvider` lists form rule files and rule summaries.
- `fliwright.createFormRules` creates a JSON template.
- `fliwright.openFormRules` opens the JSON file as text.
- `fliwright.analyzeForm` and `fliwright.fillFormWithRules` consume selected rule files.

Current schema:

```ts
export interface FormRulesFile {
  version: 1;
  locale?: string;
  rules: FormRule[];
}

export interface FormRule {
  match: Record<string, string>;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  data?: string[];
  pattern?: string;
}
```

Supported match keys should be treated as an editable set, with these common presets shown first:

- `label`
- `hintText`
- `name`
- `semanticType`
- `widgetType`
- `testId`

The editor should preserve unknown match keys rather than dropping them.

---

## 3. VS Code Integration

### 3.1 Editor Type

Use `vscode.window.registerCustomEditorProvider` with a `CustomTextEditorProvider`. Each webview panel represents exactly one `TextDocument`.

Proposed view type:

```text
fliwright.formRulesEditor
```

Reasons:

- The backing document is plain JSON text.
- The opened `.fliwright/forms/xxx.json` file stays the only editable scope.
- VS Code owns dirty state, save, undo, redo, and file watching.
- The webview can update the JSON document through workspace edits.
- Direct text edits can be reflected back into the visual editor.

### 3.2 File Association

Contribute a custom editor for JSON files matching:

```json
{
  "filenamePattern": ".fliwright/forms/*.json",
  "viewType": "fliwright.formRulesEditor",
  "displayName": "Fliwright Form Rules"
}
```

The default open behavior should be the visual editor for matched files. Opening `.fliwright/forms/login.json` from Explorer, search results, or the Fliwright Form Data tree should open the visual editor for `login.json`. The normal text editor remains available through VS Code's "Reopen Editor With..." command.

### 3.3 Commands

Add or update these commands:

| Command | Purpose |
|---------|---------|
| `fliwright.openFormRulesVisualEditor` | Open the selected `.fliwright/forms/<name>.json` file with the visual editor |
| `fliwright.openFormRulesJson` | Open that same file with the default JSON editor |
| `fliwright.createFormRules` | Create one template file, then open that file in the visual editor |
| `fliwright.analyzeForm` | Analyze current screen using the active visual editor file when available |
| `fliwright.fillFormWithRules` | Fill current screen using the active visual editor file when available |

Tree item behavior:

- Clicking a form rule file opens that specific file in the visual editor.
- Context menu includes "Open JSON".
- Invalid files open in text mode first, with a visual-editor banner available after parse recovery.

---

## 4. UX Model

The editor is an operational single-file rules workspace, not a decorative dashboard or a directory manager. It should be dense, keyboard-friendly, and visually consistent with VS Code.

Primary layout:

```text
┌────────────────────────────────────────────────────────────────────┐
│ File toolbar: login.json        12 rules   zh-CN   valid           │
├──────────────────────┬─────────────────────────────────────────────┤
│ Rule list             │ Rule detail                                 │
│                      │                                             │
│ Search/filter         │ Match                                       │
│ + Add rule            │   key: label                                │
│                      │   value: Phone number                       │
│ [label=Phone]         │                                             │
│ [label=Email]         │ Strategy                                    │
│ [hintText=Password]   │   REGEXP_MOCK                               │
│ [semantic=email]      │                                             │
│                      │ Data                                        │
│                      │   pattern: 1[3-9][0-9]{9}                   │
│                      │                                             │
│                      │ Actions                                     │
│                      │   Duplicate  Delete  Move up/down           │
└──────────────────────┴─────────────────────────────────────────────┘
```

### 4.1 Top Toolbar

Content:

- File name.
- Rule count.
- Locale selector/input.
- Validation status.
- Buttons:
  - Add rule
  - Analyze
  - Fill
  - Open JSON

Rules:

- Use Codicon-style icon buttons with tooltips where possible.
- Keep labels short. The toolbar must fit at narrow editor widths.
- Analyze and Fill are disabled when no VM Service is connected.
- The toolbar never includes a file picker. Switching files happens through VS Code tabs, Explorer, or the Form Data tree.

### 4.2 Rule List

Each row shows:

- Match summary, for example `label = 手机号`.
- Type badge:
  - `Preset`
  - `Regex`
  - `LLM`
- Validation marker if the rule is incomplete or invalid.
- Drag handle or up/down controls for ordering.

Filtering:

- Text filter searches match key, match value, type, pattern, and preset data.
- Invalid-only toggle helps quickly repair files.

Empty state:

- Shows a compact state with an Add Rule button.
- No marketing copy or large illustration.

### 4.3 Rule Detail

Rule detail is a form with three sections.

Match:

- Match key combobox with common presets and custom input.
- Match value text input.
- Helper text only for validation errors, not instructional prose.

Strategy:

- Segmented control for:
  - Preset list (`PRESET_SKILL`)
  - Regex mock (`REGEXP_MOCK`)
  - Generated (`LLM_GENERATE`)

Data:

- For `PRESET_SKILL`:
  - Editable token/list input.
  - Add value button.
  - Reorder and remove value controls.
- For `REGEXP_MOCK`:
  - Pattern text input.
  - Optional sample preview generated locally if core exposes a generator safely.
- For `LLM_GENERATE`:
  - Optional sample values list if `data` exists.
  - No prompt editor in this slice because the current schema has no prompt field.

### 4.4 Raw JSON Drawer

Add a collapsible read-only JSON preview drawer.

Purpose:

- Helps advanced users understand the generated document.
- Lets support/debug workflows inspect the exact backing object.

Behavior:

- Includes a "Open JSON Editor" command.
- Does not allow direct editing in the drawer. Direct JSON edits happen in VS Code's text editor.

---

## 5. Validation UX

Validation runs on every webview change and every document sync.

File-level validation:

- `version` must equal `1`.
- `rules` must be an array.
- `locale`, when present, must be a string.

Rule-level validation:

- `match` is required and must contain at least one string key/value pair.
- Multiple match keys are allowed to preserve existing files, but the detail form should highlight the first key and expose the rest in an "additional match keys" area.
- `type` must be `PRESET_SKILL`, `REGEXP_MOCK`, or `LLM_GENERATE`.
- `REGEXP_MOCK` requires a non-empty `pattern`.
- `PRESET_SKILL` should have a non-empty `data` array.
- `data`, when present, must be a string array.

Validation display:

- File-level errors appear in a thin banner under the toolbar.
- Rule-level errors appear on the affected list rows and fields.
- Invalid rules can still be selected and edited.
- Saving should not be blocked for recoverable schema issues, but malformed JSON cannot be represented in the visual form.

Malformed JSON flow:

1. Show an error state in the visual editor.
2. Present "Open JSON Editor" as the primary action.
3. Keep a read-only parse error message.
4. When the text document becomes valid JSON, automatically render the visual editor again.

---

## 6. Document Sync And Saving

Source of truth:

- The active VS Code `TextDocument` is the source of truth for this editor instance.
- The webview receives parsed JSON state from the provider.
- The webview posts intent messages, not full arbitrary script edits.
- The provider must not merge, scan, or update sibling files under `.fliwright/forms`.

Message shape:

```ts
type FormRulesEditorMessage =
  | { type: 'ready' }
  | { type: 'updateFile'; locale?: string }
  | { type: 'addRule'; rule?: Partial<FormRule> }
  | { type: 'updateRule'; index: number; patch: Partial<FormRule> }
  | { type: 'replaceRule'; index: number; rule: FormRule }
  | { type: 'deleteRule'; index: number }
  | { type: 'duplicateRule'; index: number }
  | { type: 'moveRule'; from: number; to: number }
  | { type: 'openJson' }
  | { type: 'analyze' }
  | { type: 'fill' };
```

Provider behavior:

- Parse the current document.
- Apply the requested intent to the parsed object.
- Serialize with `JSON.stringify(value, null, 2) + '\n'`.
- Replace the full document using `WorkspaceEdit`.

Undo/redo:

- Each user action should produce one VS Code undo step.
- Continuous text input should be debounced so typing a match value does not create one undo step per character.

Conflict handling:

- If the document changes externally while the webview is open, re-parse and refresh the webview.
- If the external change is malformed JSON, switch to the malformed state.
- No hidden in-memory shadow file should be used.
- If another `.fliwright/forms/*.json` file changes, this editor does nothing unless that file is the current document.

---

## 7. Visual Design

Tone:

- Industrial/utilitarian testing tool.
- Quiet, dense, and precise.
- Looks native inside VS Code themes.

Use VS Code theme tokens:

- `--vscode-editor-background`
- `--vscode-editor-foreground`
- `--vscode-sideBar-background`
- `--vscode-sideBar-border`
- `--vscode-input-background`
- `--vscode-input-border`
- `--vscode-button-background`
- `--vscode-button-foreground`
- `--vscode-errorForeground`
- `--vscode-warningForeground`
- `--vscode-descriptionForeground`

Layout details:

- Fixed 280px left rail on wide screens.
- Collapse to stacked layout below 720px.
- Rule rows use 4px border radius.
- Buttons use VS Code native proportions, not large card-like controls.
- No nested cards.
- No gradient/orb decoration.
- Typography uses VS Code's font variables.

Accessibility:

- All controls have labels or `aria-label`.
- Rule list supports keyboard selection.
- Add, duplicate, delete, and move actions are reachable by keyboard.
- Validation messages are connected to fields with `aria-describedby`.
- Do not rely on color alone for invalid state.

---

## 8. Implementation Plan

### FE-A: Editor Registration

Files:

- `packages/fliwright-vscode/package.json`
- `packages/fliwright-vscode/src/extension.ts`
- `packages/fliwright-vscode/src/webview/FormRulesEditorProvider.ts`

Tasks:

- Contribute `fliwright.formRulesEditor`.
- Register a `CustomTextEditorProvider`.
- Make `.fliwright/forms/*.json` use the custom editor by default.
- Ensure Explorer double-click, Form Data tree click, and command-based open all target the selected file only.
- Add "Open JSON" command support.

Acceptance:

- Opening a valid `.fliwright/forms/xxx.json` file shows the visual editor for `xxx.json`.
- Reopening with the built-in text editor still works.
- Invalid JSON shows a recoverable error state.

### FE-B: Rule Editing

Files:

- `packages/fliwright-vscode/src/webview/FormRulesEditorProvider.ts`
- optional `packages/fliwright-vscode/src/form/formRulesValidation.ts`

Tasks:

- Render toolbar, rule list, and detail form.
- Implement add, edit, duplicate, delete, and reorder.
- Serialize edits back to the active document only.
- Preserve unknown fields where possible.

Acceptance:

- Every visual edit updates the opened backing JSON document.
- Undo/redo works through VS Code.
- Tree view refresh shows updated rule counts after save or document change.

### FE-C: Validation And Command Bridge

Tasks:

- Share validation between `FormRuleService` and editor provider where practical.
- Surface validation in the editor.
- Wire Analyze and Fill buttons to existing commands using the current file URI.

Acceptance:

- Invalid rules are visible and editable.
- Analyze/Fill use the active visual editor's single file URI.
- No VM connection disables Analyze/Fill without hiding them.

### FE-D: Tests

Tests:

- Manifest contribution test for custom editor.
- Provider unit tests for intent-to-JSON transforms.
- Validation tests for valid, invalid, malformed, and unknown-field cases.
- Command routing tests for tree open, Explorer/default editor contribution, and active editor analyze/fill URI.

Verification:

```bash
pnpm --filter @fliwright/vscode lint
pnpm --filter @fliwright/vscode test
pnpm --filter @fliwright/vscode build
```

---

## 9. Open Questions

1. Should `PRESET_SKILL` require at least one value, or allow an empty list during draft editing?
2. Should multi-key `match` be formally supported in the UI, or preserved as an advanced compatibility path only?
3. Should the editor add schema metadata later, such as `description`, `tags`, or per-rule `enabled` flags?

Recommended MVP answers:

- Allow draft empty values but mark them invalid.
- Preserve multi-key matches and provide a small advanced editor for additional keys.
- Do not add schema fields until core supports them.
