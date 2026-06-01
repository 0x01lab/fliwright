---
module: "ScreenshotExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/screenshot.dart"
generated: "2026-06-01"
---

# ScreenshotExtension

> Captures screenshots by rendering the Flutter widget tree to PNG.

## Registered Extension

### `ext.fliwright.screenshot`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pixelRatio` | `double` | No | Pixel ratio (default: 1.0) |

**Returns:** `{ success: true, format: 'png', screenshot: string(base64), width: double, height: double, pixelRatio: double }`

## Implementation

- Finds the root `RenderRepaintBoundary`
- Renders to PNG via `RenderRepaintBoundary.toImage()`
- Encodes to base64
