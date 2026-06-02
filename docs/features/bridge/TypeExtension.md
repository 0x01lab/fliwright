---
module: "TypeExtension"
package: "fliwright-bridge"
source: "lib/src/extensions/type_extension.dart"
generated: "2026-06-02"
---

# TypeExtension

> Text input simulation with character-by-character typing and replaceAll support.

## Overview

Registers `ext.fliwright.type` extension. Finds an `EditableText` widget by selector, focuses it, and simulates text input via `TextEditingController`. Supports both append mode and replaceAll mode.

## Registered Extensions

### `ext.fliwright.type`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `selector` | `string` | Yes | Widget selector |
| `ancestorSelector` | `string` | No | Ancestor constraint |
| `text` | `string` | Yes | Text to input |
| `charDelay` | `string` | No | Delay between characters (ms) |
| `replaceAll` | `string` | No | `'true'` to replace existing text |

## Behavior

1. Finds the `EditableText` state by walking the element tree
2. Requests focus on the text field
3. If `replaceAll=true`, clears existing text via `userText = ''`
4. Types text character by character with configurable delay
5. Returns `{ success: true }` or `{ success: false, error, debug }`
