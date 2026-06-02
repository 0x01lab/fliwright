---
module: "Locator"
package: "@fliwright/core"
source: "src/Locator.ts"
tests: "tests/Locator.test.ts"
generated: "2026-06-02"
---

# Locator

> Resolves a selector into one or more `WidgetInfo` entries on the running Flutter app and performs gestures / text entry against the first match.

## Overview

`Locator` is the workhorse of Fliwright — every user interaction goes through one of its methods. Each action first calls `ext.fliwright.inspect` to resolve the selector into widget metadata, then dispatches a gesture or text RPC. Coordinates for `click` are computed as the center of the first match's `rect`.

## Constructor

```typescript
constructor(input: SelectorInput, sendRequest: SendRequest)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `SelectorInput` | Yes | Selector — see [Selector](./Selector.md) |
| `sendRequest` | `SendRequest` | Yes | RPC channel |

## Public Methods

### `click(): Promise<void>`

Computes the center of the first matching widget's `rect` and calls `ext.fliwright.click` with `{ x, y }`. Throws if no match or the widget has no `rect`.

---

### `longPress(options?): Promise<void>`

Calls `ext.fliwright.gesture` with `gesture: 'longPress'` and an optional `duration` (ms).

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.duration` | number | Press duration in ms |

---

### `drag(deltaX, deltaY, options?): Promise<void>`

Calls `ext.fliwright.gesture` with `gesture: 'drag'`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `deltaX` | number | Horizontal displacement |
| `deltaY` | number | Vertical displacement |
| `options.steps` | number | Optional interpolated steps |

---

### `pinch(scale, options?): Promise<void>`

Calls `ext.fliwright.gesture` with `gesture: 'pinch'`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `scale` | number | Scale factor (>1 zoom in, <1 zoom out) |
| `options.steps` | number | Optional interpolated steps |

---

### `type(text, options?): Promise<void>`

Calls `ext.fliwright.type` to insert text into the matched `EditableText`. Existing text is preserved.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | string | Text to insert |
| `options.charDelay` | number | Delay between characters in ms |
| `options.delay` | number | Alias of `charDelay` |

---

### `fill(text, options?): Promise<void>`

Like `type` but with `replaceAll: true` — clears existing content first.

---

### `scrollIntoView(options?): Promise<void>`

Calls `ext.fliwright.scrollIntoView` with `alignment` (0=top, 1=bottom, default 0.5) and `duration` (default 300ms).

---

### `count(): Promise<number>`

Returns the number of widgets currently matching the selector.

---

### `isVisible(): Promise<boolean>`

Returns `true` if at least one match exists and it has a render `rect`.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `selectorString` | string | Yes | Wire-format selector string (e.g. `"text=Login"`) |

## Example

```typescript
const email = page.locator({ key: 'email-field' });
await email.fill('leo@example.com');
await page.locator({ text: 'Submit' }).click();

const count = await page.locator({ type: 'ListTile' }).count();
const visible = await page.locator({ text: 'Welcome' }).isVisible();
```

## Related

- **Depends on:** [Selector](./Selector.md)
- **Source:** `packages/fliwright-core/src/Locator.ts`
