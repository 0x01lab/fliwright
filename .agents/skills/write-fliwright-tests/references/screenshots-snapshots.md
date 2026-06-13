# Screenshots & Snapshots

Two distinct capabilities, both on `page`:

- **Screenshots** (`page.screenshot()`) — capture the rendered pixels as a PNG `Buffer`.
- **Snapshots** (`page.snapshot()`) — capture the **semantic widget tree** as structured refs you can
  query and act on.

## Screenshots

### `screenshot(options?)`

```typescript
screenshot(options?: {
  pixelRatio?: number;                               // default 1.0
  mode?: 'auto' | 'boundary' | 'canvas';             // default 'auto'
  rect?: { x: number; y: number; width: number; height: number };  // crop, logical px
}): Promise<Buffer>                                   // PNG bytes
```

Capture strategies:

| `mode` | When to use |
| --- | --- |
| `'auto'` (default) | Detects PlatformView (WebView) and picks the best path automatically |
| `'boundary'` | Forces `RepaintBoundary.toImage()` — fast, but can't see PlatformView content |
| `'canvas'` | Forces `OffsetLayer` painting — works around WebView `debugNeedsPaint` issues |

```typescript
const png = await page.screenshot();                       // full screen
await writeFile('screen.png', png);

const region = await page.screenshot({
  pixelRatio: 2,
  mode: 'canvas',                                          // capture a WebView
  rect: { x: 0, y: 200, width: 360, height: 480 },
});
```

### `screenshotFullPage(options?)`

Scroll through scrollable content, capture segments, and stitch into one tall PNG.

```typescript
screenshotFullPage(options?: { pixelRatio?: number }): Promise<Buffer>
```

> **Note:** the bridge returns multiple segments; multi-segment PNG stitching is currently partial
> (returns the first segment when more than one is produced). Prefer `screenshot()` with a known
> scroll position, or expect a single segment, until a stitcher dependency is added.

## Snapshots (semantic tree)

### `snapshot(options?)`

Returns a structured snapshot of interactive widgets with stable `ref` handles. Requires the current
bridge (`ext.fliwright.snap`).

```typescript
snapshot(options?: {
  depth?: number;              // tree depth to capture
  includeRects?: boolean;      // include rect data per ref
  includeProperties?: boolean; // include widget properties
}): Promise<AgentSnapshotResult>
```

`AgentSnapshotResult.refs[]` each expose `{ ref, label, role, type, key, rect?, … }`.

```typescript
const snap = await page.snapshot({ depth: 4, includeRects: true });
for (const r of snap.refs) {
  console.log(r.ref, r.type, r.label, r.key);
}
```

### `ref(ref)` — pin a specific widget

Act on a ref returned by a snapshot. Refs are **ephemeral per snapshot** — never hard-code `e<N>`
across runs.

```typescript
ref(ref: string): Locator
```

```typescript
const first = snap.refs[0]?.ref;
if (first) await page.ref(first).click();
```

### `findRef(query)` — look up a ref by predicate against a fresh snapshot

When a fresh snapshot is more precise than a selector, find the ref and act on it in one step.

```typescript
findRef(query: {
  text?: string; containsText?: string; key?: string;
  semanticsLabel?: string; role?: string; type?: string;
}): Promise<Locator>
```

```typescript
const confirm = await page.findRef({ text: 'Confirm', role: 'button' });
await confirm.click();
```

### Exploration workflow (current bridge)

1. `page.snapshot({ depth, includeRects })` to see what's on screen,
2. pick a stable **query** (role + text + key) rather than an `e<N>` ref,
3. commit a resilient locator: `page.getBySemantics({ label: 'Confirm', role: 'button' })`, or
   `await page.findRef({ text: 'Confirm', role: 'button' })` captured in the same run.

MCP tools `fliwright_snap` / `fliwright_observe` use this same snapshot path — see
[mcp-workflow.md](./mcp-workflow.md).

## Bridge capability checklist

Snapshot/ref flows depend on specific extensions. If the VM returns `Unknown method "ext.fliwright.X"`,
the app is on an older bridge — upgrade/rebuild it before using that feature.

| Capability | Required for |
| --- | --- |
| `ext.fliwright.snap` | `page.snapshot()`, `page.findRef()`, MCP `fliwright_snap` / `fliwright_observe` |
| `ext.fliwright.action` | ref-backed tap/type/wait, all `Locator` actions, actionability diagnostics |
| `ext.fliwright.extractForm` | `page.formHelper.*`, `fill()`, `fillFields()` |
| `ext.fliwright.screenshot` | `page.screenshot()`, AI run-report screenshots |
| `ext.fliwright.resolve` | `Locator.resolveAll()` / `count()` / `isVisible()` |
| mock extensions (`ext.fliwright.mock.*`) | `driver.mock.*`, tool-side mock integration |

## Legacy snapshots (older bridge)

Older bridges expose `ext.fliwright.snapshot` (note: **snapshot**, not **snap**) returning a flat
`{ widgets: [...] }` list with `{ id, type, key, rect, parentType, adjacentText, description }`. The
`exio-app-e2e.test.ts` shows the legacy fallback path:

```typescript
const resp = await driver.sendRequest('ext.fliwright.snapshot') as { widgets?: LegacyWidget[] };
const widgets = resp.widgets ?? [];
```

Label these scripts as **legacy**, keep them isolated, and migrate to `ext.fliwright.snap` once the
app upgrades its bridge.
