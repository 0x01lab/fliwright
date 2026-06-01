# MCP Tools Reference

Fliwright exposes these MCP tools. When the fliwright MCP server is configured, these are available as native tools.

## `fliwright_run`

Run a fliwright test file and return pass/fail results.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testFile` | string | Yes | Path to the `.test.ts` file |
| `vmServiceUrl` | string | No | Dart VM Service WebSocket URL |
| `testName` | string | No | Run only the test matching this name |
| `cwd` | string | No | Working directory for Vitest |

**Returns:** JSON object:
```json
{
  "passed": true,
  "totalTests": 3,
  "passedTests": 3,
  "failedTests": 0,
  "duration": 2400,
  "results": [
    { "name": "should login", "passed": true, "duration": 1200 },
    { "name": "should show error", "passed": false, "duration": 800, "error": "Expected visible text 'Error' but found none" }
  ]
}
```

**Example:** Run all tests in a file
```
fliwright_run({ testFile: "tests/login.test.ts" })
```

**Example:** Run a specific test
```
fliwright_run({ testFile: "tests/login.test.ts", testName: "should login with valid credentials" })
```

---

## `fliwright_mock_list`

List all mock API endpoints, their available rules, and the currently active rule.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | | | |

**Returns:** Plain text listing:
```
GET /v1/public/token — [success ✓, empty, server_error]
POST /v1/order — [success ✓, bad_request, server_error]
```

When no rules are loaded:
```
No mock rules loaded. Ensure .fliwright/mocks/mock-index.json exists and lists endpoint config files.
```

---

## `fliwright_mock_switch`

Switch the active mock rule for an API endpoint. This changes which response the app receives.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `endpoint` | string | Yes | API endpoint path, e.g. `"/v1/public/token"` |
| `ruleName` | string | Yes | Name of the rule to activate, e.g. `"success"`, `"empty"` |
| `mockDir` | string | No | Path to `.fliwright/mocks` directory |

**Returns:** Plain text confirmation:
```
Switched: GET /v1/public/token → server_error
```

On error:
```
Error: Endpoint "/v1/unknown" not found. Registered endpoints: /v1/public/token, /v1/order
```

**Example:** Switch to error scenario
```
fliwright_mock_switch({ endpoint: "/v1/public/token", ruleName: "server_error" })
```

**Example:** Switch back to success
```
fliwright_mock_switch({ endpoint: "/v1/public/token", ruleName: "success" })
```

---

## `fliwright_get_failure`

Get detailed failure context from the most recent test run.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `testName` | string | No | Filter to a specific test name |

**Returns:** JSON object with `failures` array:
```json
{
  "failures": [
    {
      "testName": "should login with valid credentials",
      "assertion": {
        "matcher": "equals",
        "expected": "Welcome",
        "actual": "Error",
        "timeout": 5000
      },
      "widgetTree": { "...": "widget hierarchy" },
      "source": {
        "file": "tests/login.test.ts",
        "line": 42,
        "snippet": "await expect(text('Welcome')).toBeVisible()"
      },
      "healingSuggestion": {
        "originalSelector": "text('Welcome')",
        "suggestedSelector": "text('Welcome Back')",
        "confidence": 0.92,
        "scores": {
          "position": 0.95,
          "context": 0.90,
          "codeBinding": 0.88,
          "text": 0.95,
          "weighted": 0.92
        }
      },
      "timestamp": "2026-06-01T12:00:00.000Z"
    }
  ]
}
```

The `healingSuggestion` field is present when the self-healing engine found a likely match (confidence > 0.85). It contains scores for position, context, code binding, and text similarity.

---

## `fliwright_generate_test`

Generate a fliwright test script from Flutter/Dart source code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | Yes | Flutter/Dart source code of the page or widget |
| `description` | string | No | Natural language description of what to test |
| `testName` | string | No | Name for the generated test |

**Returns:** JSON object:
```json
{
  "testCode": "import { test, expect } from 'fliwright';\n\ntest('login page', async ({ page }) => { ... });",
  "testName": "login_page_test"
}
```

**Example:** Generate a test from widget source
```
fliwright_generate_test({
  source: "class LoginPage extends StatelessWidget { ... }",
  description: "Verify login form validation and successful login flow",
  testName: "login_page_test"
})
```

---

## `fliwright_record`

Record user interactions on a Flutter app and generate test code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `vmServiceUrl` | string | No | Dart VM Service WebSocket URL |
| `duration` | number | No | Recording duration in seconds (default: 30) |
| `testName` | string | No | Test name for generated code |
| `lang` | `"ts"` \| `"dart"` | No | Output language (default: `"ts"`) |

**Returns:** JSON object:
```json
{
  "testCode": "import { test, expect } from 'fliwright';\n\ntest('recorded test', async ({ page }) => { ... });",
  "testName": "checkout_flow",
  "operationCount": 12
}
```

**Example:** Record for 60 seconds
```
fliwright_record({ duration: 60, testName: "checkout_flow", lang: "ts" })
```

---

## Resource: `test_report`

Access results from the most recent test run via the MCP resource URI:

```
fliwright://test-report/latest
```

Returns the same `RunResult` structure as `fliwright_run`:
```json
{
  "passed": true,
  "totalTests": 3,
  "passedTests": 3,
  "failedTests": 0,
  "duration": 2400,
  "results": [
    { "name": "should login", "passed": true, "duration": 1200 },
    { "name": "should show error", "passed": false, "duration": 800, "error": "..." }
  ]
}
```
