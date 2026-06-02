---
module: "ScreenshotExtension"
package: "fliwright_bridge"
source: "lib/src/extensions/screenshot.dart"
generated: "2026-06-02"
---

# ScreenshotExtension

> Capture a PNG screenshot of the rendered Flutter surface.

## Registered Methods

| Method | Description |
|--------|-------------|
| `ext.fliwright.screenshot` | Return base64-encoded PNG |

### `ext.fliwright.screenshot`

No params.

**Returns:** `{ screenshot: '<base64 PNG>' }` on success. `{ screenshot: null }` if capture fails (e.g. headless test environment).

Captured via `RenderingFlutterBinding.instance.takeScreenshot(...)` when available, with a fallback to `RepaintBoundary.toImage`.

## Related

- **TS counterpart:** [`FailureCollector._takeScreenshot`](../core/FailureCollector.md)
- **Source:** `packages/fliwright-bridge/lib/src/extensions/screenshot.dart`
