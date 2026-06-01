---
module: "Locator"
package: "@fliwright/core"
source: "src/Locator.ts"
generated: "2026-06-01"
---

# Locator

> Widget locator that provides gesture actions (click, drag, pinch), text input (type, fill), scrolling, and query methods (count, isVisible).

## Overview

`Locator` wraps a selector and a sendRequest function. It does not eagerly resolve the widget — resolution happens when an action is invoked. Actions send JSON-RPC requests to the Flutter bridge extension to perform gestures and queries.

## Constructor

```typescript
constructor(input: SelectorInput, sendRequest: SendRequest)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `input` | `SelectorInput` | Yes | Selector input |
| `sendRequest` | `SendRequest` | Yes | JSON-RPC request sender |

## Public Methods

### `click(): Promise<void>`

Taps the widget at its center.

### `longPress(options?: { duration?: number }): Promise<void>`

Performs a long press on the widget.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.duration` | `number` | Duration in ms (default: 500) |

### `drag(deltaX: number, deltaY: number, options?: { steps?: number }): Promise<void>`

Drags the widget by the given delta.

| Parameter | Type | Description |
|-----------|------|-------------|
| `deltaX` | `number` | Horizontal displacement |
| `deltaY` | `number` | Vertical displacement |
| `options.steps` | `number` | Number of intermediate steps (default: 10) |

### `pinch(scale: number, options?: { steps?: number }): Promise<void>`

Performs a pinch gesture on the widget.

| Parameter | Type | Description |
|-----------|------|-------------|
| `scale` | `number` | Pinch scale factor |
| `options.steps` | `number` | Number of intermediate steps (default: 10) |

### `type(text: string, options?: { delay?: number; charDelay?: number }): Promise<void>`

Types text character by character into the widget.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to type |
| `options.delay` | `number` | Initial delay before typing |
| `options.charDelay` | `number` | Delay between characters in ms |

### `fill(text: string, options?: { delay?: number; charDelay?: number }): Promise<void>`

Replaces existing text in the widget with new text.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to fill |
| `options.delay` | `number` | Initial delay before filling |
| `options.charDelay` | `number` | Delay between characters in ms |

### `scrollIntoView(options?: { alignment?: number; duration?: number }): Promise<void>`

Scrolls the widget into view.

| Parameter | Type | Description |
|-----------|------|-------------|
| `options.alignment` | `number` | 0=top, 0.5=center, 1=bottom (default: 0.5) |
| `options.duration` | `number` | Scroll animation duration in ms (default: 300) |

### `count(): Promise<number>`

Returns the number of widgets matching this locator's selector.

### `isVisible(): Promise<boolean>`

Returns whether at least one matching widget is visible.

## Properties

| Property | Type | Readonly | Description |
|----------|------|----------|-------------|
| `selectorString` | `string` | Yes | The serialized selector string |

## Related

- **Depends on:** [Selector](./Selector.md)
- **Used by:** [Page](./Page.md), [Assertion](./Assertion.md)
- **Source:** `src/Locator.ts`
