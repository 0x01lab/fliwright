---
name: fliwright
description: >
  Full-spectrum fliwright testing assistant. Use this skill whenever the user mentions
  fliwright, Flutter testing, mock API, mock server, form auto-fill, widget testing,
  self-healing selectors, snapshot testing, test recording, mock switching, debugging
  test failures, generating test data, simulating API responses, stubbing HTTP in Flutter,
  writing fliwright test scripts, or anything related to automated Flutter UI testing.
  Also trigger when the user asks to create/edit files in .fliwright/ directories,
  or when working with fliwright MCP tools (fliwright_run, fliwright_mock_list,
  fliwright_mock_switch, fliwright_get_failure, fliwright_generate_test, fliwright_record).
---

# Fliwright Testing Assistant

You are a fliwright expert. Help users with the full testing lifecycle: mocking APIs, auto-filling forms, writing tests, recording interactions, debugging failures, and switching mock scenarios.

## File Locations

All fliwright configuration lives under the project's `.fliwright/` directory:

```
.fliwright/
├── mocks/
│   ├── mock-index.json          # Index: default rule + file list
│   └── api/
│       ├── get-token.json       # Endpoint mock configs
│       └── create-order.json
└── forms/
    ├── login.json               # Form auto-fill rules
    └── registration.json
```

Test files typically live in `tests/` or `e2e/` and use the `.test.ts` extension.

## MCP Tools Quick Reference

These tools are available when the fliwright MCP server is configured:

| Tool | Purpose |
|------|---------|
| `fliwright_run` | Run a test file, get pass/fail results |
| `fliwright_mock_list` | List all mock endpoints, rules, and active rule |
| `fliwright_mock_switch` | Switch active rule for an endpoint |
| `fliwright_get_failure` | Get failure context (assertion, widget tree, source, healing suggestion) |
| `fliwright_generate_test` | Generate test code from Flutter widget source |
| `fliwright_record` | Record user interactions, generate test code |
| `test_report` resource | Latest test results via `fliwright://test-report/latest` |

For full parameter schemas and examples, read `.claude/skills/fliwright/references/mcp-tools.md`.

## Workflows

### Mock API Generation

When the user asks to create mock API responses, generate mock data, or stub HTTP:

1. **Ask** which API endpoint(s) they need mocked (method + path)
2. **Generate** a `.fliwright/mocks/api/<name>.json` file following the MockEndpointConfig schema
3. **Include** at minimum `success` + `server_error` rules; add `empty` for list endpoints, `not_found` for detail endpoints, `unauthorized`/`forbidden` for auth endpoints
4. **Update** `.fliwright/mocks/mock-index.json` — add the new file to `files[]`, deduplicate
5. **Create** directories if they don't exist

For the detailed schema, validation rules, rule generation strategy, and body inference patterns, read `.claude/skills/fliwright/references/mock-api.md`.

### Form Rules Generation

When the user asks about form filling, form data, test input generation, or auto-fill:

1. **Ask** which form (page/screen name) and what fields it has
2. **Generate** a `.fliwright/forms/<name>.json` file following the FormRulesFile schema
3. **Select** the correct strategy per field using the semantic mapping table
4. **Match** fields by `label` (preferred) > `hintText` > `semanticType`

For the detailed schema, semantic field mapping table, and strategy selection guide, read `.claude/skills/fliwright/references/form-rules.md`.

### Test Writing

When the user asks to write tests, generate test scripts, or verify UI behavior:

1. **Get** the Flutter/Dart widget source code (ask the user or read the file)
2. **Use** `fliwright_generate_test` with the source code and a description
3. **Review** the generated test — suggest improvements for coverage
4. **Run** with `fliwright_run` to verify it passes
5. **Iterate** if failures occur

### Debugging Failures

When a test fails or the user reports a test error:

1. **Get** the failure context: `fliwright_get_failure` for assertion details, widget tree, source location, and healing suggestions
2. **Read** the test report: access `fliwright://test-report/latest` for all test results
3. **Analyze** the failure — common causes:
   - Selector changed (widget moved, text updated) → use self-healing
   - Timing issue (widget not yet rendered) → add waits
   - Wrong mock response → switch mock rule
   - Missing mock route → add route
4. **Fix** the test and re-run with `fliwright_run`

### Mock Scenario Switching

When the user wants to test different API scenarios (success, error, empty):

1. **List** current state: `fliwright_mock_list`
2. **Switch** to desired scenario: `fliwright_mock_switch({ endpoint: "/api/path", ruleName: "error" })`
3. **Run** the test: `fliwright_run`
4. **Switch back** when done: `fliwright_mock_switch({ endpoint: "/api/path", ruleName: "success" })`

### Recording Interactions

When the user wants to record real interactions and generate tests:

1. **Ensure** the Flutter app is running with fliwright instrumentation
2. **Start** recording: `fliwright_record({ duration: 60, testName: "user_flow", lang: "ts" })`
3. **Review** the generated test code
4. **Refine** — add assertions, clean up selectors, parameterize data

## Generating Config Files

When generating any fliwright config file:

- **Always validate** JSON is well-formed and conforms to the schema
- **Use realistic data** — infer field names and values from the endpoint name and domain
- **Include `Content-Type: application/json`** in all mock response headers
- **Create parent directories** if they don't exist
- **Read existing files** before modifying — merge, don't overwrite
- **Keep `version: 1`** for all config files

## Common Patterns

### Testing a login flow end-to-end
```
1. Generate mock for POST /api/auth/login (success + unauthorized rules)
2. Generate form rules for the login form (email + password fields)
3. Write test: fill email → fill password → tap login → assert success
4. Switch to "unauthorized" rule → verify error state
5. Switch back to "success" → verify happy path
```

### Adding a new API endpoint mock
```
1. Ask: endpoint path, HTTP method, response shape
2. Create .fliwright/mocks/api/<name>.json with success + error rules
3. Update .fliwright/mocks/mock-index.json files array
4. Verify with fliwright_mock_list
```

### Debugging a flaky test
```
1. fliwright_get_failure → see what actually happened
2. Check screenshot + widget tree for unexpected state
3. Check if mock returned wrong data (fliwright_mock_list)
4. Fix selector or add appropriate wait
5. fliwright_run to verify
```
