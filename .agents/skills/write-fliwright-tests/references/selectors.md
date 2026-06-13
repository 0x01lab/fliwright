# Selectors & Locators

A **Locator** describes how to find a widget. It does nothing until you act on it (`click()`,
`fill()`, `expect()`, …) or resolve it (`count()`, `isVisible()`, `resolve()`). Construct locators
from `page` (or from another locator to scope).

## Selector preference order

Prefer, in this order:

1. stable **`Key`** — `page.getByKey('submit')`
2. **semantics** identifier / label / role — `page.getBySemantics({ label: 'Log in', role: 'button' })`
3. exact visible **text** — `page.getByText('Submit')`
4. scoped text/type
5. widget **type** as a last resort — `page.getByType('ElevatedButton')`

## The `getByX` family

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

The same family exists on **`Locator`** too (it scopes as a descendant):

```typescript
const form = page.getByType('LoginForm');
await form.getByText('Email').fill('alice@example.com');
```

## Object-form selectors

Anything you can pass to `page.locator(...)`:

```typescript
page.locator({ text: 'Log in' });
page.locator({ key: 'loginButton' });
page.locator({ type: 'ElevatedButton' });
page.locator({ subtype: 'FilledButton' });
page.locator({ tooltip: 'Save changes' });
page.locator({ semantics: { label: 'Log in', role: 'button' } });
```

## String selector formats

| Format | Example | Meaning |
| --- | --- | --- |
| `text=<value>` | `text=Submit` | exact visible text |
| `textContains=<value>` | `textContains=Sub` | text containing substring |
| `key=<value>` | `key=submitButton` | widget `Key` |
| `type=<value>` or `byType=<value>` | `type=ElevatedButton` | widget type |
| `subtype=<value>` | `subtype=FilledButton` | widget subtype |
| `tooltip=<value>` | `tooltip=Save` | tooltip message |
| `semantics=<value>` | `semantics=Email address` | semantics label |
| `role=<value>` | `role=button` | semantics role |
| plain string | `Submit` | treated as exact text |
| `RegExp` | `/log in/i` | text regex |

`page.waitFor(selector, timeout)` accepts these strings, e.g. `await page.waitFor('text=注册成功', 5000)`.

## Text matching modes

`getByText` / `getBySemantics` accept a `match` mode and `caseSensitive`:

```typescript
page.getByText('Log in');                       // exact
page.getByText('log in', { match: 'contains' }); // substring
page.getByText(/log.*in/i);                      // regex via RegExp
page.getByText('Log in', { exact: true });        // explicit exact
```

## Scoping & disambiguation

When a selector matches multiple widgets, narrow it down:

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

`nth`, `first`, and `last` accept `{ visible: true }` to additionally filter to hit-testable widgets:

```typescript
nth(index: number, options?: { visible?: boolean }): Locator
first(options?: { visible?: boolean }): Locator
last(options?: { visible?: boolean }): Locator
```

## Advanced selectors

These compose on top of the base query and map to the wire-protocol AST.

### `filter(criteria)` — post-filter matched widgets

```typescript
filter(criteria: FilterCriteria): Locator
```

`FilterCriteria` lets you keep only matches with a given state, enabled flag, text, or count within a region:

```typescript
// only enabled buttons
page.getByType('ElevatedButton').filter({ enabled: true });

// only widgets containing specific text
page.getByType('ListTile').filter({ text: 'In stock' });
```

### `containing(descendant)` — a parent that contains a descendant

```typescript
containing(descendant: SelectorInput): Locator
```

Find a container because of what it contains (e.g. the list tile that has a "Delete" button):

```typescript
const row = page.getByType('ListTile').containing({ text: 'Alice' });
await row.getByKey('delete').click();
```

### `subtype` and `tooltip` — direct getters

```typescript
page.getBySubtype('FilledButton');   // resolves to .locator({ subtype })
page.getByTooltip('Save');           // resolves to .locator({ tooltip })
```

### State / position filtering

`FilterCriteria` and `PositionFilter` support state-based narrowing (enabled/disabled, visible,
index among siblings). Use these instead of fragile `.nth(0)` first-match behavior:

```typescript
// the enabled submit among several submit-like buttons
page.getBySemantics({ role: 'button' }).filter({ enabled: true, text: 'Submit' });
```

## Refs (snapshots)

For exploration, refs from a snapshot can pin a specific widget instance:

```typescript
const snap = await page.snapshot({ depth: 4, includeRects: true });
const first = snap.refs[0]?.ref;
if (first) await page.ref(first).click();

// or look a ref up by predicate against a fresh snapshot
const loc = await page.findRef({ text: 'Confirm', role: 'button' });
await loc.click();
```

**Do not** hard-code `e<N>` refs in committed tests — they are ephemeral per snapshot. Capture the
snapshot in the same run, or commit a resilient query locator instead. See
[screenshots-snapshots.md](./screenshots-snapshots.md).

## Reading a Locator without acting

```typescript
await loc.count();                 // number of matches (any visibility)
await loc.isVisible();             // boolean
await loc.resolve();               // first matching WidgetInfo | undefined
await loc.resolveAll(options?);    // WidgetInfo[]
```

`resolveAll` options: `{ visible?: 'any' | 'hitTestable'; strict?: boolean; limit?: number }`.

## Choosing a selector — worked example

Goal: tap "Submit" on a screen that also has a disabled "Submit" elsewhere.

❌ Fragile — first match is unstable:
```typescript
await page.getByText('Submit').click();
```

✅ Resilient — semantics role + filter to enabled, scoped to the form:
```typescript
const form = page.getByType('RegistrationForm');
await form.getBySemantics({ label: 'Submit', role: 'button' }).filter({ enabled: true }).click();
```
