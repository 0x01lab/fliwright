---
feature: "Form Auto-Fill Pipeline"
packages: ["@fliwright/core", "fliwright-bridge"]
status: implemented
agent_accessible: false
generated: "2026-06-01"
---

# Form Auto-Fill Pipeline

> Automatically fills Flutter forms using semantic inference and Faker-generated data.

## Architecture

1. **FormHelper** (`FormHelper`): Orchestrates form extraction, inference, generation, and filling.
2. **FormExtractExtension** (Dart bridge): Extracts TextField/TextFormField metadata from the widget tree.
3. **SemanticInferrer** (`SemanticInferrer`): Infers semantic types from hints, labels, and keyboard types.
4. **FakerGenerator** (`FakerGenerator`): Generates realistic fake data based on semantic type.
5. **SkillRegistry** (`SkillRegistry`): Custom skill matching and generation.
6. **JsonRuleLoader** (`JsonRuleLoader`): Loads custom rules from JSON files.
7. **SelectorResolver** (`SelectorResolver`): Resolves widget info to selector strings.

## Data Flow

```
FormHelper.fill()
    │
    ▼
Bridge: ext.fliwright.extractForm
    │
    ▼
FormFieldMeta[] (fields with hintText, label, keyboardType, etc.)
    │
    ├── JsonRuleLoader.autoDiscover() → custom FormSkill[]
    ├── SkillRegistry.register(skills)
    │
    ▼
For each field:
    │
    ├── SkillRegistry.match(field) → custom skill?
    │   └── Yes → skill.generate(field, locale)
    │   └── No → SemanticInferrer.inferField(field) → SemanticType
    │            └── FakerGenerator.generate(semanticType) → fake value
    │
    ▼
Locator.fill(generatedValue) → Bridge: ext.fliwright.type
    │
    ▼
FormFillResult { filled, skipped, errors, fields[] }
```

## Key Files

- `packages/fliwright-core/src/FormHelper.ts` — Form fill orchestrator
- `packages/fliwright-core/src/SemanticInferrer.ts` — Semantic type inference
- `packages/fliwright-core/src/FakerGenerator.ts` — Fake data generation
- `packages/fliwright-core/src/SkillRegistry.ts` — Custom skill registry
- `packages/fliwright-core/src/JsonRuleLoader.ts` — JSON rule loading
- `packages/fliwright-core/src/SelectorResolver.ts` — Selector resolution
- `packages/fliwright-bridge/lib/src/extensions/form_extract.dart` — Dart form extraction
