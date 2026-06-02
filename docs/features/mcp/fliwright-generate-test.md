---
module: "fliwright_generate_test"
package: "@fliwright/mcp"
source: "src/tools/generateTest.ts"
generated: "2026-06-02"
---

# `fliwright_generate_test`

> Generate a Fliwright test script from a Flutter/Dart source snippet by parsing out text widgets, buttons, and text fields, then emitting a `test()` block that types into fields, clicks buttons, and asserts visibility.

## Description

`handleGenerateTest` parses the supplied `source` string with `parseFlutterSource`, classifies widgets into `text | button | textField`, and synthesizes a Vitest test file that:

1. For each `textField`: clicks the field, then types `'test_input'`.
2. For each `button`: clicks it via `page.locator({ text: '...' })`.
3. For the last `text` widget: asserts visibility via `expect(...).toBeVisible()`.

## Input Schema

```typescript
{
  source: string;            // required
  description?: string;      // optional natural-language intent
  testName?: string;         // optional, defaults to "generated test"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | Yes | Flutter/Dart source code of the page or widget to test |
| `description` | string | No | Natural-language description of what the test should verify (currently advisory) |
| `testName` | string | No | Name for the generated `test()` block. Default `'generated test'` |

## Output

```typescript
{
  testName: string;
  testCode: string;          // full file including imports + test block
  widgets: Array<{ type, text?, hintText? }>;
}
```

## Example

```json
{
  "name": "fliwright_generate_test",
  "arguments": {
    "source": "class LoginPage extends StatelessWidget { ... }",
    "testName": "login flow"
  }
}
```
