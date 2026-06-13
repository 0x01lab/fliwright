# Forms & Auto-Fill

`page.formHelper` extracts every editable field on the current screen, infers each field's
**semantic type**, generates a realistic fake value, and can fill them for you. Use it to smoke-test
forms or avoid brittle per-field selectors.

> Requires the bridge extension `ext.fliwright.extractForm`. On an older bridge it returns `[]` or
> `Unknown method "ext.fliwright.extractForm"` — see [troubleshooting.md](./troubleshooting.md).

## The pipeline

```
extractForm (bridge)        → raw FormFieldMeta[] (id, selector, hintText, semanticsId, rect, …)
SemanticInferrer.infer()    → maps each field → SemanticType (phone, email, password, idCard, …)
SkillRegistry.match()       → applies .fliwright/forms/*.json rules (REGEXP_MOCK, fixed, …)
FakerGenerator.generate()   → realistic value for the semantic type + locale
fill() / fillFields()       → writes values back through locator.fillWithResolved()
```

## `analyze(options?)`

Inspect without filling. Returns every field with its inferred type and the value that *would* be
generated.

```typescript
interface FormHelperOptions { scope?: string; skipObscureFields?: boolean; locale?: string; rulesPath?: string }
analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult>
```

Each field in the result:

| Field | Meaning |
| --- | --- |
| `id` | stable field id from the bridge |
| `semanticType` | inferred type: `phone`, `email`, `password`, `idCard`, `fullName`, `address`, `captcha`, `text`, … |
| `generatedValue` | the fake value that would be filled |
| `selector` | selector string usable with `page.locator()` (e.g. `text=请输入手机号`) |
| `hintText`, `label`, `key`, `name`, `semanticsId`, `semanticsLabel`, `role` | raw metadata for matching |

```typescript
// e2e
const analysis = await page.formHelper.analyze();
for (const f of analysis.fields) {
  console.log(`${f.semanticType} | hintText="${f.hintText}" | selector="${f.selector}" → "${f.generatedValue}"`);
}
viExpect(analysis.fields.length).toBeGreaterThanOrEqual(6);

// Match precisely by selector to avoid hintText substring collisions
const phone = analysis.fields.find(f => f.selector === 'text=请输入手机号');
viExpect(phone?.semanticType).toBe('phone');
viExpect(phone?.generatedValue).toMatch(/^1[3-9]\d{9}$/);
```

## `fill(options?)`

Fill **all** fields. Returns counts and per-field status.

```typescript
fill(options?: FormHelperOptions): Promise<FormFillResult>
```

`FormFillResult`:

| Field | Meaning |
| --- | --- |
| `filled` | count filled |
| `skipped` | count skipped (e.g. obscure fields when `skipObscureFields`) |
| `errors` | array of fill errors |
| `fields[]` | per-field `{ id, semanticType, generatedValue, status }` where `status ∈ 'filled' | 'skipped' | 'error'` |

```typescript
// e2e — skip password fields
const result = await page.formHelper.fill({ skipObscureFields: true });
console.log(`Filled ${result.filled}, Skipped ${result.skipped}, Errors ${result.errors.length}`);
viExpect(result.errors).toHaveLength(0);

const passwordField = result.fields.find(f => f.semanticType === 'password');
viExpect(passwordField?.status).toBe('skipped');   // password was skipped
```

## `fillFields(fieldHints, options?)`

Fill a **subset** by hint. A field matches a hint if its `hintText`/`label`/`name`/`semanticsId`
includes the hint string.

```typescript
fillFields(fieldHints: string[], options?: FormHelperOptions): Promise<FormFillResult>
```

```typescript
// e2e — fill only 手机号 and 验证码
const result = await page.formHelper.fillFields(['手机号', '验证码'], { skipObscureFields: true });
viExpect(result.fields.find(f => f.semanticType === 'phone')?.status).toBe('filled');
viExpect(result.fields.find(f => f.semanticType === 'captcha')?.status).toBe('filled');
viExpect(result.fields.find(f => f.semanticType === 'email')?.status).toBe('skipped');
```

## Options

| Option | Purpose |
| --- | --- |
| `scope` | restrict extraction to a widget subtree by type name, e.g. `'RegisterPage'` |
| `skipObscureFields` | skip password/obscure fields (default false) |
| `locale` | locale for faker generation (e.g. `'zh-CN'`) |
| `rulesPath` | path to a form-rules JSON file to load into the skill registry |

Scoping matters when multiple forms are on screen (e.g. a ShellRoute with a settings panel):

```typescript
const scoped = await page.formHelper.analyze({ scope: 'RegisterPage' });
```

## Form-rules JSON (`.fliwright/forms/*.json`)

Override generation per field with explicit rules. Schema (a `FormRulesFile`):

```json
{
  "version": 1,
  "locale": "zh-CN",
  "rules": [
    {
      "match": { "label": "手机号" },
      "type": "REGEXP_MOCK",
      "pattern": "1[3-9][0-9]{9}"
    },
    {
      "match": { "semanticType": "email" },
      "type": "FIXED",
      "value": "qa@example.com"
    }
  ]
}
```

Rule `match` keys: `label`, `hintText`, `name`, `semanticType`, `semanticsId`, `key`. Rule `type`
includes `REGEXP_MOCK`, `FIXED`, and faker-backed generators. The loader (`JsonRuleLoader`) reads
these and the skill registry consults them before falling back to faker. The VS Code extension loads
`.fliwright/forms/*.json` and passes the file/dir to `FormHelper`.

## When to use formHelper vs explicit locators

| Use `formHelper` | Use explicit `getByKey().fill()` |
| --- | --- |
| Smoke-testing that every enabled field is fillable | Business-critical fields where the exact value matters |
| Generating realistic fake data for a large form | Fields whose value must be asserted on later |
| Avoiding brittle selectors across many screens | Submit/critical path fields |

```typescript
// explicit for the value that must match a downstream assertion
await page.getByKey('email').fill('alice@example.com');
await page.getByKey('password').fill('correct-horse-battery-staple');

// formHelper to smoke-fill the rest
await page.formHelper.fill({ skipObscureFields: false });
```
