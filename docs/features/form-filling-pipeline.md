---
feature: "Form Auto-Fill Pipeline"
packages: ["@fliwright/core", "fliwright_bridge", "@fliwright/vscode"]
status: implemented
agent_accessible: true
mcp_tool: "—"
generated: "2026-06-02"
---

# Form Auto-Fill Pipeline

> Discover all form fields in the currently rendered Flutter screen, infer each field's semantic type from labels and keyboard hints, generate a realistic value (Faker or rule-based), and fill the field — replacing brittle manual `fillForm` calls with a single `formHelper.fill()`.

## Architecture

1. **Field extraction** (bridge `FormExtractExtension`): walks the widget tree, collects every `TextField` / `TextFormField` / `EditableText`, deduplicates by controller identity, and emits one `FormFieldMeta` per field with `hintText`, `label`, `key`, `keyboardType`, `maxLength`, `rect`, and a stable `selector`.
2. **Semantic inference** (`SemanticInferrer.infer`): maps each field to a `SemanticType` (`phone | email | idCard | address | fullName | password | captcha | date | number | url | text`) using regex over `hintText`/`label`, falling back to `keyboardType`.
3. **Skill registry** (`SkillRegistry.match`): if the user supplied custom rules (e.g. `{ "hintContains": "公司名", "value": "$faker.company.name()" }`), the registry returns a matching `FormSkill` which overrides Faker generation.
4. **Rule loading** (`JsonRuleLoader.loadFromFile` / `loadFromDir` / `autoDiscover`): reads `.fliwright/form-rules.json` files into the registry.
5. **Value generation** (`FakerGenerator.generate`): produces localized, length-bounded values via `@faker-js/faker` for fields without a matching skill. Supports `randexp` for regex-based rules.
6. **Filling** (`FormHelper.fill` / `fillFields`): iterates fields, invokes the bridge's `type` extension to enter text, captures per-field success/skipped/error status, and returns a structured `FormFillResult`.
7. **Analyze-only mode** (`FormHelper.analyze`): returns the proposed value for each field without typing — used by VS Code's Form Data view and the `fliwright.analyzeForm` command.

## Agent Integration

- **Programmatic**: `driver.page.formHelper.fill({ locale: 'zh_CN' })`.
- **VS Code**: command palette → `Fliwright: Analyze Form` (preview) / `Fill Form` / `Fill Form With Rules`.
- **Custom rules**: drop a `.fliwright/form-rules.json` in the workspace root; the VS Code extension auto-discovers it via `JsonRuleLoader.autoDiscover`.

## Data Flow

```
FormHelper.fill
   │
   ├── bridge ext.fliwright.formExtract ──> FormFieldMeta[]
   │
   ├── SemanticInferrer.infer             ──> Map<fieldId, SemanticType>
   │
   ├── JsonRuleLoader.autoDiscover ──> SkillRegistry
   │       └── SkillRegistry.match(field) ──> FormSkill?
   │
   ├── FakerGenerator.generate(type, maxLength)  ──> fallback value
   │
   ├── for each field:
   │       └── bridge ext.fliwright.type(value, selector)
   │
   └── FormFillResult { filled, skipped, errors, fields[] }
```

## Key Files

- `packages/fliwright-core/src/FormHelper.ts` — orchestrator (`fill`, `analyze`, `fillFields`).
- `packages/fliwright-core/src/SemanticInferrer.ts` — regex + keyboardType → semantic type.
- `packages/fliwright-core/src/FakerGenerator.ts` — Faker-backed value generation.
- `packages/fliwright-core/src/SkillRegistry.ts` — custom rule matching.
- `packages/fliwright-core/src/JsonRuleLoader.ts` — `.fliwright/form-rules.json` parser.
- `packages/fliwright-core/src/SelectorResolver.ts` — converts meta to wire selector.
- `packages/fliwright-bridge/lib/src/extensions/form_extract.dart` — Dart field extractor.
- `packages/fliwright-bridge/lib/src/extensions/type.dart` — Dart text-entry simulator.
- `packages/fliwright-vscode/src/form/` — VS Code form commands and FormHelperService.
