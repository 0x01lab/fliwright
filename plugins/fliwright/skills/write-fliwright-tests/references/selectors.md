# 选择器与 Locator（Selectors & Locators）

**Locator** 描述了如何找到一个控件。在你不对其进行操作（`click()`、`fill()`、`expect()` ……）或解析（`count()`、`isVisible()`、`resolve()`）之前，它什么都不会做。从 `page`（或从另一个 locator 来限定范围）构造 locator。

## 选择器优先顺序

按下面的顺序优先选用：

1. 稳定的 **`Key`** — `page.getByKey('submit')`
2. **semantics** 的 identifier / label / role — `page.getBySemantics({ label: 'Log in', role: 'button' })`
3. 精确的可见 **text** — `page.getByText('Submit')`
4. 限定范围后的 text/type
5. 控件 **type** 作为最后手段 — `page.getByType('ElevatedButton')`

## `getByX` 家族

```typescript
page.getByText(text: string | RegExp, options?: { exact?: boolean; match?: 'exact' | 'contains' | 'regex'; caseSensitive?: boolean }): Locator
page.getByKey(key: string): Locator
page.getByType(type: string): Locator
page.getBySubtype(subtype: string): Locator                 // e.g. 'ElevatedButton' within Button
page.getBySemantics(semantics: {
  identifier?: string; label?: string; hint?: string; role?: string;
  match?: 'exact' | 'contains' | 'regex'; caseSensitive?: boolean;
}): Locator
page.getByTooltip(tooltip: string): Locator
```

**`Locator`** 上同样提供这套家族方法（作为后代限定范围）：

```typescript
const form = page.getByType('LoginForm');
await form.getByText('Email').fill('alice@example.com');
```

## 对象形式的选择器

任何你能传给 `page.locator(...)` 的形式：

```typescript
page.locator({ text: 'Log in' });
page.locator({ key: 'loginButton' });
page.locator({ type: 'ElevatedButton' });
page.locator({ subtype: 'FilledButton' });
page.locator({ tooltip: 'Save changes' });
page.locator({ semantics: { label: 'Log in', role: 'button' } });
```

## 字符串选择器格式

| 格式 | 示例 | 含义 |
| --- | --- | --- |
| `text=<value>` | `text=Submit` | 精确可见文本 |
| `textContains=<value>` | `textContains=Sub` | 包含子串的文本 |
| `key=<value>` | `key=submitButton` | 控件的 `Key` |
| `type=<value>` 或 `byType=<value>` | `type=ElevatedButton` | 控件类型 |
| `subtype=<value>` | `subtype=FilledButton` | 控件子类型 |
| `tooltip=<value>` | `tooltip=Save` | tooltip 消息 |
| `semantics=<value>` | `semantics=Email address` | semantics label |
| `role=<value>` | `role=button` | semantics role |
| 纯字符串 | `Submit` | 视作精确文本 |
| `RegExp` | `/log in/i` | 文本正则 |

`page.waitFor(selector, timeout)` 接受这些字符串，例如 `await page.waitFor('text=注册成功', 5000)`。

## 文本匹配模式

`getByText` / `getBySemantics` 接受一个 `match` 模式和 `caseSensitive`：

```typescript
page.getByText('Log in');                       // exact
page.getByText('log in', { match: 'contains' }); // substring
page.getByText(/log.*in/i);                      // regex via RegExp
page.getByText('Log in', { exact: true });        // explicit exact
```

## 限定范围与消歧

当一个选择器匹配到多个控件时，可以这样收窄：

```typescript
// Descendant scoping — find within a parent
const form = page.getByType('LoginForm');
await form.getByText('Email').fill('alice@example.com');

// .and(...) — all conditions must match the same widget
await page.getByText('Save').and({ type: 'ElevatedButton' }).click();

// .or(...) — any condition matches
page.locator({}).or({ key: 'altSave' }).click();

// .nth(index) — pick one by position
await page.getByType('TextField').nth(1).fill('secret');

// .first() / .last()
await page.getByText('Item').first().click();
await page.getByText('Item').last({ visible: true }).click();

// .ancestor(...) — match an ancestor of a widget
await page.locator({ text: 'Submit' }).ancestor({ type: 'Form' }).click();
```

`nth`、`first` 和 `last` 接受 `{ visible: true }`，可进一步过滤为可命中测试的控件：

```typescript
nth(index: number, options?: { visible?: boolean }): Locator
first(options?: { visible?: boolean }): Locator
last(options?: { visible?: boolean }): Locator
```

## 高级选择器

它们在基础查询之上做组合，并映射到 wire-protocol AST。

### `filter(criteria)` — 对匹配到的控件做后置过滤

```typescript
filter(criteria: FilterCriteria): Locator
```

`FilterCriteria` 让你只保留具备某种状态、特定 enabled 标记、特定文本，或在某个区域内数量符合要求的匹配项：

```typescript
// only enabled buttons
page.getByType('ElevatedButton').filter({ enabled: true });

// only selected checkbox/radio-like controls
page.getBySemantics({ role: 'checkbox' }).filter({ checked: true });

// only widgets containing specific text
page.getByType('ListTile').filter({ text: 'In stock' });
```

### `containing(descendant)` — 包含某个后代的父控件

```typescript
containing(descendant: SelectorInput): Locator
```

因为它包含某个后代控件来找到容器（例如包含 "Delete" 按钮的列表项）：

```typescript
const row = page.getByType('ListTile').containing({ text: 'Alice' });
await row.getByKey('delete').click();
```

### `subtype` 和 `tooltip` — 直接 getter

```typescript
page.getBySubtype('FilledButton');   // resolves to .locator({ subtype })
page.getByTooltip('Save');           // resolves to .locator({ tooltip })
```

### 基于状态/位置的过滤

`FilterCriteria` 和 `PositionFilter` 支持基于状态收窄（enabled/disabled、visible、在兄弟节点中的 index）。优先用这些，而不是脆弱的 `.nth(0)` 取首匹配行为：

```typescript
// the enabled submit among several submit-like buttons
page.getBySemantics({ role: 'button' }).filter({ enabled: true, text: 'Submit' });
```

## 自定义 checkbox / radio / switch

Fliwright 会从 Flutter semantics 读取选择状态。原生 `Checkbox` / `Switch` / `Radio` 直接可用；自定义控件需要业务组件暴露语义：

```dart
Semantics(
  identifier: 'kyc.gender.male',
  label: 'Male',
  checked: selected, // checkbox/radio
  onTap: onTap,
  child: CustomRadio(...),
)
```

`Switch` 风格控件也可以用 `toggled: value`；分段控件/选项卡可用 `selected: isSelected`。测试里优先选择稳定 identifier，其次 label + role：

```typescript
const male = page.getBySemantics({ identifier: 'kyc.gender.male', role: 'checkbox' });
await male.check();
await expect(male, 'Male option selected').toBeChecked();
```

如果 snapshot 里看不到 `checked=true/false`、`toggled=true` 或 `selected=true`，说明组件语义还没暴露出来；先改组件语义，不要退回坐标点击或图像判断。

## Ref（快照）

用于探索时，来自快照的 ref 可以固定到某个具体的控件实例：

```typescript
const snap = await page.snapshot({ depth: 4, includeRects: true });
const first = snap.refs[0]?.ref;
if (first) await page.ref(first).click();

// or look a ref up by predicate against a fresh snapshot
const loc = await page.findRef({ text: 'Confirm', role: 'button' });
await loc.click();
```

**不要**在提交的测试里硬编码 `e<N>` 形式的 ref —— 它们对每个快照而言都是临时的。要么在同一次运行里抓取快照，要么提交一个稳定可查询的 locator。参见 [screenshots-snapshots.md](./screenshots-snapshots.md)。

## 不做操作地读取 Locator

```typescript
await loc.count();                 // number of matches (any visibility)
await loc.isVisible();             // boolean
await loc.resolve();               // first matching WidgetInfo | undefined
await loc.resolveAll(options?);    // WidgetInfo[]
```

`resolveAll` 的 options：`{ visible?: 'any' | 'hitTestable'; strict?: boolean; limit?: number }`。

## 选择器选型 —— 实战示例

目标：在屏幕上点击 "Submit"，但屏幕别处还有一个被禁用的 "Submit"。

❌ 脆弱 —— 取首匹配不稳定：
```typescript
await page.getByText('Submit').click();
```

✅ 稳定 —— semantics role + 过滤为 enabled，并限定在表单内：
```typescript
const form = page.getByType('RegistrationForm');
await form.getBySemantics({ label: 'Submit', role: 'button' }).filter({ enabled: true }).click();
```
