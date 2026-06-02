---
module: "ScreenshotExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/screenshot.dart"
generated: "2026-06-02"
---

# ScreenshotExtension

> Screenshot capture using Flutter's RenderRepaintBoundary.

## Overview

Registers `ext.fliwright.screenshot` extension. Captures the current Flutter view as a PNG image encoded in base64.

## Registered Extensions

### `ext.fliwright.screenshot`

No parameters required.

Returns `{ screenshot: string }` — base64-encoded PNG screenshot of the current view.
