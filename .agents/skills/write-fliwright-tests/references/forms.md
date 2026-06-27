# 表单与自动填充（Forms & Auto-Fill）

`page.formHelper` 会抽取当前屏幕上每个可编辑字段，推断每个字段的**语义类型（semantic type）**，生成逼真的假数据，并可以替你填入。可以用它来做表单的冒烟测试，或者避免为每个字段写脆弱的选择器。

> 需要桥接扩展 `ext.fliwright.extractForm`。在较旧的桥接上会返回 `[]` 或
> `Unknown method "ext.fliwright.extractForm"` —— 见 [troubleshooting.md](./troubleshooting.md)。

## 处理管线（The pipeline）

```
extractForm (bridge)        → raw FormFieldMeta[] (id, selector, hintText, semanticsId, rect, …)
SemanticInferrer.infer()    → maps each field → SemanticType (phone, email, password, idCard, …)
SkillRegistry.match()       → applies .fliwright/forms/*.json rules (REGEXP_MOCK, fixed, …)
FakerGenerator.generate()   → realistic value for the semantic type + locale
fill() / fillFields()       → writes values back through locator.fillWithResolved()
```

## `analyze(options?)`

只分析不填充。返回每个字段及其推断类型，以及*将会*生成的值。

```typescript
interface FormHelperOptions { scope?: string; skipObscureFields?: boolean; locale?: string; rulesPath?: string }
analyze(options?: FormHelperOptions): Promise<FormAnalyzeResult>
```

结果中每个字段：

| 字段 | 含义 |
| --- | --- |
| `id` | 来自桥接的稳定字段 id |
| `semanticType` | 推断类型：`phone`、`email`、`password`、`idCard`、`fullName`、`address`、`captcha`、`text`、… |
| `generatedValue` | 将会被填入的假数据值 |
| `selector` | 可用于 `page.locator()` 的选择器字符串（例如 `text=请输入手机号`） |
| `hintText`, `label`, `key`, `name`, `semanticsId`, `semanticsLabel`, `role` | 用于匹配的原始元数据 |

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

填充**全部**字段。返回计数与每个字段的状态。

```typescript
fill(options?: FormHelperOptions): Promise<FormFillResult>
```

`FormFillResult`：

| 字段 | 含义 |
| --- | --- |
| `filled` | 已填充的数量 |
| `skipped` | 被跳过的数量（例如 `skipObscureFields` 启用时的隐蔽字段） |
| `errors` | 填充错误数组 |
| `fields[]` | 每个字段的 `{ id, semanticType, generatedValue, status }`，其中 `status ∈ 'filled' | 'skipped' | 'error'` |

```typescript
// e2e — skip password fields
const result = await page.formHelper.fill({ skipObscureFields: true });
console.log(`Filled ${result.filled}, Skipped ${result.skipped}, Errors ${result.errors.length}`);
viExpect(result.errors).toHaveLength(0);

const passwordField = result.fields.find(f => f.semanticType === 'password');
viExpect(passwordField?.status).toBe('skipped');   // password was skipped
```

## `fillFields(fieldHints, options?)`

按 hint 填充**一部分**字段。当字段的 `hintText`/`label`/`name`/`semanticsId`
包含 hint 字符串时即视为匹配。

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

## 选项（Options）

| 选项 | 用途 |
| --- | --- |
| `scope` | 按类型名将抽取范围限定到某个控件子树，例如 `'RegisterPage'` |
| `skipObscureFields` | 跳过密码/隐蔽字段（默认 false） |
| `locale` | faker 生成时使用的区域（例如 `'zh-CN'`） |
| `rulesFile` | 要加载进 skill registry 的表单规则 JSON 文件路径 |
| `rulesDir` | 要加载进 skill registry 的表单规则目录；默认自动发现 `.fliwright/forms/*.json` |
| `requireRuleMatch` | 只填充命中规则的字段，登录/注册关键路径推荐开启 |
| `dataIndex` | 固定选择 `data[]` 中第几组数据；省略时按字段轮换 |
| `aiRuntime` | 供 `ai:` / `{ "prompt": "..." }` 数据 DSL 调用的 AI runtime |

当屏幕上同时存在多个表单时（例如带设置面板的 ShellRoute），限定范围就很重要：

```typescript
const scoped = await page.formHelper.analyze({ scope: 'RegisterPage' });
```

## 表单规则 JSON（`.fliwright/forms/*.json`）

通过显式规则按字段覆盖生成行为。Schema（一个 `FormRulesFile`）：

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
      "type": "PRESET_SKILL",
      "data": ["qa@example.com"]
    },
    {
      "find": { "match": { "semanticIdentifier": "order.id" } },
      "type": "PRESET_SKILL",
      "data": ["re:ORD-[0-9]{8}"]
    },
    {
      "match": { "semanticType": "fullName" },
      "type": "LLM_GENERATE",
      "data": [
        {
          "prompt": "生成一个中文测试用户姓名，不要解释",
          "fallback": "测试用户"
        }
      ]
    }
  ]
}
```

规则的 `match` 键包括：`label`、`hintText`、`name`、`semanticType`、`semanticsId`、`key`。规则的 `type`
取以下之一：`PRESET_SKILL`（在 `data[]` 中轮换取值；单元素数组等价于固定值）、
`REGEXP_MOCK`（生成匹配 `pattern` 的值）、或 `LLM_GENERATE`（AI 生成；当 AI 关闭时回退到
`data[]` —— 见 [ai.md](./ai.md)）。加载器（`JsonRuleLoader`）读取这些规则，skill registry 在
回退到 faker 之前会先查询它们。VS Code 扩展会加载
`.fliwright/forms/*.json`，并把文件/目录传给 `FormHelper`。

### `data[]` DSL

`data[]` 里的普通字符串永远按固定值处理，所以 `"https://example.com"` 不会因为包含冒号而被误判。只有明确前缀或对象字段才启用 DSL：

| 写法 | 含义 |
| --- | --- |
| `"qa@example.com"` | 固定值 |
| `"text:literal:value"` / `{ "value": "literal:value" }` | 固定值，适合值本身需要 DSL 前缀时转义 |
| `"re:ORD-[0-9]{8}"` / `"regex:..."` / `{ "regex": "..." }` | 按正则生成值 |
| `"ai:生成一个测试公司名"` / `"prompt:..."` / `{ "prompt": "...", "fallback": "测试公司" }` | 调用 `aiRuntime.generate()` 生成 `{ "value": "..." }` |

在 script/test 中使用 AI 规则时，把 fixture 的 `aiRuntime` 传给 form helper：

```typescript
script('fill generated profile', async ({ page, aiRuntime }) => {
  await page.formHelper.fill({
    rulesFile: '.fliwright/forms/profile.json',
    requireRuleMatch: true,
    aiRuntime,
  });
});
```

没有传 `aiRuntime` 时，prompt 规则如果声明了 `fallback` 就使用 fallback；否则会报错，避免静默填入不确定值。

## 何时用 formHelper vs 显式 locator

| 用 `formHelper` | 用显式 `getByKey().fill()` |
| --- | --- |
| 冒烟验证每个启用字段都可填充 | 取值必须精确的关键业务字段 |
| 为大表单生成逼真假数据 | 之后需要对字段值做断言 |
| 跨多屏避免脆弱选择器 | 提交/关键路径上的字段 |

```typescript
// explicit for the value that must match a downstream assertion
await page.getByKey('email').fill('alice@example.com');
await page.getByKey('password').fill('correct-horse-battery-staple');

// formHelper to smoke-fill the rest
await page.formHelper.fill({ skipObscureFields: false });
```

## Select 字段与组件专用动作

`formHelper` 能处理带明确 `options` 的 checkbox / radio / select，但 Flutter
里的 select 组件实现差异很大。写规则或脚本时先分清组件能力：

| 组件形态 | 推荐方式 |
| --- | --- |
| 标准 dropdown，桥接能看到 `items` / `onChanged` | `locator.selectOption(value)` 或 formHelper 的内置 select 填充 |
| 自定义 bottom sheet / dialog select | 写组件专用 helper：打开字段、等待 option、点击 option、必要时点确认 |
| 国家/地区 picker 这类 searchable + 虚拟列表 | 写国家选择 helper：打开字段、输入国家名触发 `TextField.onChanged`、等待/滚动到 option、点击 option |

不要把某个组件的流程直接套到所有 select 上。例如国家/地区 picker 需要搜索框和
`*.option.HK` semantics；普通 employment status select 可能只需要打开后点击
`FULL_TIME` option。

当某类复杂 select 在多个表单中复用时，用 `select.recipe` 调用同一套
`page.select` recipe，而不是在每个 `.fliwright/forms/*.json` 里重复写低层点击步骤：

```json
{
  "match": { "name": "countryField" },
  "find": { "match": { "semanticIdentifier": "myForm.countryField.select" } },
  "type": "PRESET_SKILL",
  "data": ["HK"],
  "action": {
    "script": "select.recipe",
    "args": {
      "recipe": "countryPicker",
      "search": { "match": { "key": "myForm.countrySelect.searchField", "type": "EditableText" } },
      "searchText": "Hong Kong",
      "optionSemanticsId": "myForm.countryField.option.${value}"
    }
  }
}
```
