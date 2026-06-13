# Navigation & Waiting

Fliwright can drive route navigation when the app exposes its router to the bridge, and provides
waiting primitives so tests stay free of fixed `sleep()` calls.

## App-side setup

Route navigation requires the app to inject a router (e.g. GoRouter) into the bridge:

```dart
await FliwrightBridge.init(router: myGoRouter);   // enables ext.fliwright.navigate / currentRoute / goBack
```

Without a router, `page.navigate()` will throw a bridge-side error. Widget-level navigation
(tapping a button that pushes a route) always works regardless.

## `navigate(path)`

```typescript
navigate(path: string, options?: { extra?: Record<string, unknown> }): Promise<void>
```

Pushes a route. `extra` is forwarded to the router as extra data.

```typescript
await page.navigate('/login');
await page.navigate('/users/42', { extra: { referrer: 'search' } });
```

## `currentRoute()`

```typescript
currentRoute(): Promise<string>   // current route path, or '' if unknown
```

```typescript
const route = await page.currentRoute();
viExpect(route).toContain('login');
```

## `goBack()`

```typescript
goBack(): Promise<void>   // pop the current route
```

```typescript
await page.navigate('/register');
// …
await page.goBack();
```

## Waiting primitives

### `waitFor(selector, timeout)`

Poll until a selector resolves to at least one widget.

```typescript
waitFor(selector: SelectorInput, timeoutMs = 5000): Promise<Locator>
```

```typescript
const success = await page.waitFor('text=注册成功', 5000);
viExpect(await success.isVisible()).toBe(true);
```

Throws on timeout. Accepts the same string formats as selectors (`text=`, `key=`, …).

### `waitForNew(selector, options?)`

Wait for a **new** element matching the selector that **did not exist** when the call started.
Essential after a navigation/click that replaces the page — it avoids matching stale widgets that
are still on screen during a transition animation.

```typescript
waitForNew(selector: SelectorInput, options?: { timeout?: number }): Promise<Locator>
```

```typescript
await page.getByKey('openDetails').click();
const details = await page.waitForNew('text=Details', { timeout: 5000 });
await expect(details).toBeVisible();
```

It snapshots current matching IDs at call time, then polls for matches whose ID is not in that set.

### `settle(options?)`

Wait for Flutter's rendering pipeline to settle — N consecutive frames with no scheduled work.
Use after a click that triggers a route transition, before querying the new page.

```typescript
settle(options?: { timeout?: number }): Promise<void>   // default timeout 2000 ms
```

```typescript
await page.getByKey('submit').click();
await page.settle();                 // let the transition finish
await expect(page.getByText('Welcome')).toBeVisible();
```

`Locator.click({ waitForAnimations: true })` does a settle automatically — prefer that over a
manual `settle()` after a click.

### `waitForNetworkIdle(options?)`

Wait until the app has had no network activity for a quiet window. Useful after an action kicks off
background fetches.

```typescript
waitForNetworkIdle(options?: { quietMs?: number; timeout?: number }): Promise<void>
```

```typescript
await page.getByText('Refresh').click();
await page.waitForNetworkIdle({ quietMs: 300, timeout: 8000 });
```

### `dismissModal()`

Dismiss a modal dialog/sheet via the action extension.

```typescript
dismissModal(): Promise<void>
```

## Pattern: navigate, wait, assert

```typescript
test('navigates between routes', async ({ page }) => {
  await page.navigate('/register');
  await page.waitFor('text=请输入手机号', 5000);          // wait for page to render

  await page.navigate('/profile/edit');
  await page.waitFor('text=输入昵称', 5000);

  await page.goBack();
});
```

## Pattern: scope navigation per test

Reset to a known route before each test so order doesn't matter:

```typescript
import { test, beforeEach } from '@fliwright/vitest';

beforeEach(async ({ page }) => {
  await page.navigate('/');
});
```

## When to use what

| Situation | Use |
| --- | --- |
| After a click triggers a page transition | `click({ waitForAnimations: true })` or `settle()` |
| Wait for a specific widget to appear | `waitFor(selector)` or auto-waiting `expect(...).toBeVisible()` |
| Wait for a widget that **replaces** a same-type widget on the previous page | `waitForNew(selector)` |
| Wait for background fetches | `waitForNetworkIdle()` |
| Read the current route | `currentRoute()` |

Avoid `setTimeout`/`sleep`. The only legitimate uses are inside `clickAt`-style legacy flows where
no widget event signals readiness (see `e2e/exio-app-e2e.test.ts`).
