---
module: "Locator"
package: "@fliwright/core"
source: "src/Locator.ts"
generated: "2026-06-02"
---

# Locator

> Widget locator that resolves selectors to Flutter widgets and performs actions: click, longPress, drag, pinch, type, fill, scrollIntoView.

## Overview

`Locator` wraps a `Selector` and communicates with the Flutter bridge via `ext.fliwright.inspect` to resolve widgets, then uses `ext.fliwright.click`, `ext.fliwright.gesture`, `ext.fliwright.type`, and `ext.fliwright.scrollIntoView` for interactions.

## Constructor

```typescript
constructor(input: SelectorInput, sendRequest: SendRequest)
```

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `selectorString` | `string` | Yes | The wire-format selector string |

## Public Methods

### `click(): Promise<void>`

Resolves the selector, computes the widget's center point, and sends a tap gesture.

### `longPress(options?: { duration?: number }): Promise<void>`

Performs a long press gesture via `ext.fliwright.gesture`.

### `drag(deltaX: number, deltaY: number, options?: { steps?: number }): Promise<void>`

Performs a drag gesture with the given delta.

### `pinch(scale: number, options?: { steps?: number }): Promise<void>`

Performs a pinch gesture with the given scale factor.

### `type(text: string, options?: { delay?: number; charDelay?: number }): Promise<void>`

Types text character by character into the matched widget.

### `fill(text: string, options?: { delay?: number; charDelay?: number }): Promise<void>`

Replaces existing text (replaceAll=true) in the matched widget.

### `scrollIntoView(options?: { alignment?: number; duration?: number }): Promise<void>`

Scrolls the widget into view. Default alignment: 0.5 (center), duration: 300ms.

### `count(): Promise<number>`

Returns the number of widgets matching the selector.

### `isVisible(): Promise<boolean>`

Returns whether at least one matching widget has render bounds.

## Related

- **Depends on:** [Selector](./Selector.md)
- **Source:** `src/Locator.ts`
