---
feature: "Form Auto-Fill Pipeline"
packages: ["@fliwright/core", "fliwright-bridge"]
status: implemented
agent_accessible: false
generated: "2026-06-02"
---

# Form Auto-Fill Pipeline

> Automatically extracts form fields from a Flutter screen, infers their semantic types, generates appropriate fake data, and fills them using Locator actions.

## Architecture

1. **Extract Fields** (`FormHelper` → `ext.fliwright.extractForm`): The Dart `FormExtractExtension` walks the widget tree, finds all `TextField`, `TextFormField`, `Checkbox`, `DropdownButton`, etc., extracts metadata (type, key, hintText, label, keyboardType, obscureText, enabled, value, options), and deduplicates overlapping entries.

2. **Infer Semantics** (`SemanticInferrer`): For each field, infers a `SemanticType` by:
   - Checking `controlType` (checkbox → boolean, radio/select → option)
   - Regex matching on `hintText`/`label` (phone, email, idCard, address, fullName, password, captcha, date)
   - Mapping `keyboardType` (phone, emailAddress, number, url, visiblePassword)

3. **Load Rules** (`JsonRuleLoader` → `SkillRegistry`): Auto-discovers and loads form rules from:
   - `fliwright.form-rules.json` (single file)
   - `fliwright.form-rules/*.json` (directory)
   Each rule defines match criteria, type (PRESET_SKILL, REGEXP_MOCK, LLM_GENERATE), and data/pattern.

4. **Generate Values** (`FakerGenerator` + `SkillRegistry`): For each field:
   - If a custom skill matches, use its `generate()` function
   - Otherwise, use `FakerGenerator.generate(semanticType)` for locale-aware fake data
   - Handle control types: checkbox (boolean), radio/select (option selection)

5. **Fill Fields** (`FormHelper` → `Locator`): Fills each field using `Locator.fill()` for text inputs or `Locator.click()` for buttons/checkboxes/radios. Uses a fallback selector strategy: `semanticsId` → `name` → `key` → `ancestorKey` → `id` → parsed selector.

6. **Return Results** (`FormHelper`): Returns `FormFillResult` with counts of filled/skipped/errors and per-field details.

## Data Flow

```
Flutter App Screen
    │
    ▼
ext.fliwright.extractForm (FormExtractExtension)
    ├── Walk widget tree
    ├── Find TextField/TextFormField/Checkbox/etc.
    ├── Extract metadata (type, key, hint, label, etc.)
    └── Deduplicate
    │
    ▼
FormFieldMeta[]
    │
    ▼
SemanticInferrer.infer()
    ├── controlType → boolean/option
    ├── hintText regex → phone/email/idCard/...
    └── keyboardType → phone/email/number/...
    │
    ▼
Map<fieldId, SemanticType>
    │
    ▼
JsonRuleLoader.autoDiscover() → SkillRegistry
    │
    ▼
For each field:
    ├── SkillRegistry.match(field) → custom skill?
    │   ├── YES → skill.generate()
    │   └── NO  → FakerGenerator.generate(semanticType)
    │
    ├── controlType logic:
    │   ├── textInput → Locator.fill(value)
    │   ├── checkbox → Locator.click() (if not already checked)
    │   ├── radio → click option label (scoped to field)
    │   └── select → click field first, then click option
    │
    └── Fallback selector: semanticsId → name → key → ancestorKey → id → selector
    │
    ▼
FormFillResult { filled, skipped, errors, fields[] }
```

## Key Files

- `packages/fliwright-core/src/FormHelper.ts` — Form fill orchestration
- `packages/fliwright-core/src/SemanticInferrer.ts` — Semantic type inference
- `packages/fliwright-core/src/FakerGenerator.ts` — Fake data generation
- `packages/fliwright-core/src/SkillRegistry.ts` — Custom skill matching
- `packages/fliwright-core/src/JsonRuleLoader.ts` — JSON rule loading
- `packages/fliwright-core/src/SelectorResolver.ts` — Role mapping
- `packages/fliwright-bridge/lib/src/extensions/form_extract.dart` — Dart-side field extraction
