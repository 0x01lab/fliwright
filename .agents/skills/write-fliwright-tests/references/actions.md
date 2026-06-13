# Actions

Act on a `Locator`. Every action returns `Promise<void>` and throws an `Error` whose message includes
the bridge's diagnostic `contextDump` (up to 10 visible widgets) when no widget is found — read it
when a tap mysteriously fails.

All actions send to `ext.fliwright.action` with `{ action, ...selectorParams, ...options }`.
`alignment` (default `'center'`) controls the tap point within the matched rect:
`'center' | 'topLeft' | 'topCenter' | 'topRight' | 'centerLeft' | 'centerRight' |
'bottomLeft' | 'bottomCenter' | 'bottomRight'`.

## Taps & presses

```typescript
click(options?: {
  alignment?: AlignmentOption;
  timeout?: number;
  waitForAnimations?: boolean;   // settle Flutter animations after the tap
  settleTimeout?: number;        // ms for the settle step (default 2000)
}): Promise<void>
```

```typescript
await page.getByText('Continue').click();
await page.getByKey('go').click({ waitForAnimations: true, settleTimeout: 3000 });

// multi-clicks
await loc.doubleClick();
await loc.tripleClick();
await loc.rightClick();          // long-press-equivalent on touch

// hover / focus
await loc.hover();
await loc.focus();
await loc.blur();
```

`doubleClick` / `tripleClick` / `rightClick` / `hover` / `focus` take `{ alignment?, timeout? }`.
`blur` takes `{ timeout? }`.

## Long press

```typescript
longPress(options?: { duration?: number; alignment?: AlignmentOption; timeout?: number }): Promise<void>
```

```typescript
await page.getByText('Delete').longPress({ duration: 700 });
```

## Drag (relative, by delta)

Drag the element from its center by a delta. Positive Y is down.

```typescript
drag(deltaX: number, deltaY: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>

dragTo(direction: 'left' | 'right' | 'up' | 'down', distance?: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>
```

```typescript
await page.getByType('Slider').drag(120, 0, { steps: 12 });        // 120px right
await listTile.dragTo('left', 160);                                // swipe-to-reveal action
```

## Pinch (zoom)

```typescript
pinch(scale: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>
```

```typescript
await page.getByType('InteractiveViewer').pinch(1.25);   // zoom in
await page.getByType('InteractiveViewer').pinch(0.8);    // zoom out
```

## Slider / captcha: `slideTo`

Slide an element to an absolute X coordinate (e.g. a slider knob for a captcha).

```typescript
slideTo(targetX: number, options?: {
  steps?: number; alignment?: AlignmentOption; timeout?: number;
}): Promise<void>
```

```typescript
await page.getByKey('sliderKnob').slideTo(340, { steps: 25 });
```

## Text input

```typescript
type(text: string, options?: { delay?: number; charDelay?: number; timeout?: number }): Promise<void>
fill(text: string, options?: { delay?: number; charDelay?: number; timeout?: number }): Promise<void>
clear(options?: { timeout?: number }): Promise<void>
```

- **`fill()`** replaces the field's current value (`replaceAll: true`). Use for setting a known value.
- **`type()`** appends/types (`replaceAll: false`). Use when you want real keystroke behavior.
- `charDelay` (alias: `delay`) sets per-character delay in ms.

```typescript
await page.getByKey('email').fill('alice@example.com');
await page.getByKey('search').type('hello', { charDelay: 30 });
await page.getByKey('email').clear();
```

## Keys, checkboxes, options

```typescript
pressKey(key: string, options?: { timeout?: number }): Promise<void>          // e.g. 'Enter', 'Backspace'
setCheckbox(checked: boolean, options?: { timeout?: number }): Promise<void>
selectOption(value: string | number, options?: { timeout?: number }): Promise<void>  // dropdown / picker
```

```typescript
await page.getByKey('agree').setCheckbox(true);
await page.getByKey('country').selectOption('CN');
await page.getByKey('search').pressKey('Enter');
```

## Scroll into view

```typescript
scrollIntoView(options?: { alignment?: number; duration?: number; timeout?: number }): Promise<void>
```

`alignment` (default `0.5`) is where within the viewport the widget should settle (0 = top, 1 = bottom).

```typescript
await page.getByText('Checkout').scrollIntoView();
await page.getByText('Checkout').scrollIntoView({ alignment: 0.2, duration: 400 });
```

## Raw coordinates (outside the widget tree)

Use these for surfaces **not** in the Flutter widget tree — WebView overlays, captcha sliders, ads.

```typescript
// on Page:
page.clickAt(x: number, y: number): Promise<void>
page.dragFrom(x: number, y: number, deltaX: number, deltaY: number, options?: { steps?: number }): Promise<void>
```

`clickAt` sends `ext.fliwright.click`; `dragFrom` sends `ext.fliwright.dragFrom` (default 20 steps).

```typescript
await page.clickAt(114, 204);
await page.dragFrom(120, 420, 0, -280, { steps: 16 });   // swipe up
```

> Coordinate-based tests are inherently brittle (resolution/scale-dependent). Reach for them only
> when a locator cannot represent the target, and prefer environment-overridable coordinates
> (`process.env.MY_TAP_X`) so the test can be tuned without code edits.

## Acting on a pre-resolved widget (fast path)

When you already resolved a widget (e.g. via `formHelper.analyze()`), avoid re-resolving:

```typescript
await loc.fillWithResolved(text, resolvedWidget, options?: { charDelay?: number });
await loc.clickResolved(resolvedWidget);
```

## Failure diagnostics

When an action can't find its target, the thrown error includes the bridge's `contextDump`:

```
tap failed debug=… 

Visible widgets on screen:
  - ElevatedButton "Submit" [key=submit] role=button
  - TextField "Email" semantics="Email address"
  ...
```

Read this list first — it tells you what is actually on screen and why your selector missed.
