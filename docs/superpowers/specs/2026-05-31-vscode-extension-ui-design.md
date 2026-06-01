# VS Code Extension UI Design

**Date**: 2026-05-31  
**Status**: Draft  
**Scope**: UI/UX design for the Fliwright VS Code extension MVP  
**Parent Design**: `docs/superpowers/specs/2026-05-31-vscode-extension-design.md`  
**HTML Prototype**: `docs/superpowers/prototypes/vscode-extension-preview.html`

---

## 1. Design Direction

Fliwright's VS Code extension should feel like an operational testing tool inside the editor, not a separate dashboard or marketing surface. The UI should be dense, predictable, and fast to scan.

Design principles:

- Use VS Code native surfaces first: Activity Bar, Tree Views, Status Bar, CodeLens, Quick Pick, OutputChannel.
- Keep the sidebar compact. Put only high-signal controls there.
- Use Webviews only where layout needs screenshots, JSON inspection, timelines, or generated-code previews.
- Prefer Codicons and native VS Code command affordances over custom decorative UI.
- Make failure repair the primary workflow: run, inspect, open source, copy/apply selector.
- Never auto-edit test files without an explicit user action and diff preview.

---

## 2. Information Architecture

```text
Fliwright Activity Bar
├── Devices
│   ├── Connection status
│   ├── VM Service URL
│   └── Bridge capability checks
├── Mock APIs
│   ├── API endpoint files
│   ├── Response rules
│   └── Active mock routes
├── Form Data
│   ├── Form rule files
│   ├── Rule summaries
│   └── Analyze/fill actions
├── Tests
│   ├── Test files
│   ├── Test cases
│   └── Run commands
├── Runs
│   ├── Latest run summary
│   ├── Failed tests
│   └── Failure context entries
└── Sandbox / Adapters
    ├── State adapters
    └── Future hardware mocks

Editor Area
├── Failure Context Webview
├── Recording Webview
└── Trace Viewer Webview

Global
├── Status Bar
├── Command Palette
├── CodeLens
└── Fliwright OutputChannel
```

Recommended user path:

1. Connect in `Devices`.
2. Run test from `Tests` or CodeLens.
3. Inspect failed item in `Runs`.
4. Use Failure Webview to open source or apply selector suggestion.
5. Use Recording Webview to generate new tests.
6. Use Mock APIs and Form Data for setup-heavy flows.

---

## 3. VS Code Container

### 3.1 Activity Bar

Contribution:

- Container label: `Fliwright`
- Icon: use a simple test/control-oriented product icon later; MVP can use a Codicon-compatible monochrome asset.
- Badge behavior:
  - No badge when idle or all tests pass.
  - Numeric badge for failed tests after the latest run.
  - Recording state is shown in Status Bar, not as a badge.

### 3.2 View Ordering

Default order:

1. `Devices`
2. `Mock APIs`
3. `Form Data`
4. `Tests`
5. `Runs`
6. `Sandbox / Adapters` when state/hardware adapters are enabled

Reasoning: connection gates most operations. The first implementation slice prioritizes Mock and Form setup, so those views appear before test execution and run history.

### 3.3 Sidebar Density

Target dimensions:

| Element | Size |
|---------|------|
| Tree row height | VS Code default |
| Primary toolbar icon | 16px Codicon |
| Section title | Native view title |
| Inline status text | 12px-13px, inherited VS Code font |
| Long URLs | Middle truncation |

Avoid large custom headers in the sidebar. Each tree should work well at 260px width.

---

## 4. Devices View

Purpose: show connection state and bridge capabilities.

Toolbar actions:

| Icon | Command | Tooltip |
|------|---------|---------|
| `plug` | `fliwright.connect` | Connect to VM Service |
| `debug-disconnect` | `fliwright.disconnect` | Disconnect |
| `refresh` | `fliwright.discoverVmService` | Discover VM Service |
| `settings-gear` | Open extension settings | Configure Fliwright |

### 4.1 Disconnected

```text
DEVICES
  ○ No VM Service
    Start Flutter in debug/profile mode

  Connect to VM Service
  Discover Local App
```

Behavior:

- `Connect to VM Service` opens an input box.
- `Discover Local App` scans local endpoints.
- If `fliwright.vmServiceUrl` exists, show it as a remembered option.

### 4.2 Connecting

```text
DEVICES
  ◌ Connecting
    ws://127.0.0.1:8181/ws
```

Behavior:

- Disable run/record/sandbox commands while connecting.
- Show progress in Status Bar.

### 4.3 Connected

```text
DEVICES
  ● Connected
    riverpod_demo
    ws://127.0.0.1:8181/ws

  Capabilities
    ✓ gestures
    ✓ recording
    ✓ snapshot
    ✓ mock server
    ✓ form extract
```

Visual rules:

- Green check only through theme-aware Codicon state color if available.
- Capability rows are plain tree children, not badges.
- Missing capabilities are warning rows:

```text
    ! recording unavailable
```

Click behavior:

- Clicking VM URL copies it.
- Clicking a missing capability opens a setup help message.

### 4.4 Error State

```text
DEVICES
  ! Connection failed
    ECONNREFUSED 127.0.0.1:8181

  Retry
  Discover Local App
  Open Output
```

Error text must be short. Full details go to `Fliwright` OutputChannel.

---

## 5. Tests View

Purpose: discover tests and start runs.

Toolbar actions:

| Icon | Command | Tooltip |
|------|---------|---------|
| `run-all` | `fliwright.runWorkspaceTests` | Run Workspace Tests |
| `refresh` | Refresh test discovery | Refresh Tests |
| `filter` | Toggle failed-only after run | Filter Tests |

### 5.1 Empty State

```text
TESTS
  No Fliwright tests found
  Pattern: tests/**/*.test.ts

  Create Example Test
  Open Settings
```

### 5.2 Discovered Tests

```text
TESTS
  tests/login.test.ts
    ○ shows login form
    ○ rejects invalid credentials
    ○ accepts valid credentials

  tests/cart.test.ts
    ○ adds item to cart
    ○ updates quantity
```

Icons:

| State | Icon |
|-------|------|
| Not run | `circle-outline` |
| Running | `sync~spin` |
| Passed | `pass` |
| Failed | `error` |
| Healed | `wand` or `sparkle` if available; otherwise `pass-filled` with description `healed` |
| Skipped | `circle-slash` |

Context menu:

- Run Test File
- Run Test Case
- Open Test
- Reveal in Explorer
- Copy Test Name

### 5.3 Active Run

```text
TESTS
  tests/login.test.ts
    ◌ shows login form
    ○ rejects invalid credentials
    ○ accepts valid credentials
```

Rules:

- Show only one active spinner per currently executing test case if known.
- If only file-level progress is known, spinner goes on the file row.
- Do not animate custom UI in tree items.

---

## 6. Runs View

Purpose: summarize latest test result and route users into failure context.

Toolbar actions:

| Icon | Command | Tooltip |
|------|---------|---------|
| `clear-all` | Clear run history | Clear Runs |
| `output` | Open OutputChannel | Open Fliwright Output |
| `json` | Copy latest run JSON | Copy Run JSON |

### 6.1 No Run

```text
RUNS
  No test run yet
  Run a test to see results
```

### 6.2 Passing Run

```text
RUNS
  ✓ Latest Run
    5 passed · 0 failed · 1.2s

  tests/login.test.ts
    ✓ shows login form 120ms
    ✓ rejects invalid credentials 340ms
```

### 6.3 Failing Run

```text
RUNS
  ✗ Latest Run
    4 passed · 1 failed · 1.7s

  Failures
    ✗ cart updates quantity
      Assertion: toBeVisible
      Source: tests/cart.test.ts:42
      Healing: no match above threshold

  Passed
    ✓ login shows form 120ms
```

Failure item click:

- Opens Failure Context Webview.
- Also reveals source in editor side-by-side when source location exists.

Context menu:

- Open Failure Context
- Open Source
- Copy Failure JSON
- Copy Error Message

### 6.4 Healed Run

```text
RUNS
  ✓ Latest Run
    5 passed · 0 failed · 1 healed · 1.4s

  Healed
    ✨ payment confirm button
      text=确认支付 -> text=去结算
      Confidence 0.94
```

Healed entries should be visible even when tests pass, because they are maintenance work.

---

## 7. Mock APIs View

Purpose: list local API Mock JSON files, choose response rules, and apply/clear active routes.

Toolbar actions:

| Icon | Command | Tooltip |
|------|---------|---------|
| `play` | `fliwright.applyDefaultMocks` | Apply Default Mocks |
| `debug-stop` | `fliwright.stopSandbox` | Clear Mocks |
| `refresh` | `fliwright.reloadMocks` | Reload Mock Configs |
| `add` | `fliwright.createMockConfig` | Create Mock Config |

### 7.1 Default State

```text
MOCK APIS
  Config Directory
    .fliwright/mocks/api
    3 endpoints · 8 rules

  GET /v1/public/token
    ○ success 200
    ○ empty 200
    ○ server_error 500
  POST /api/login
    ○ success 200
    ○ invalid_password 401
```

### 7.2 Applied State

```text
MOCK APIS
  ● Active
    2 routes applied

  GET /v1/public/token
    ✓ success 200
    ○ empty 200
    ○ server_error 500
  POST /api/login
    ✓ invalid_password 401
```

### 7.3 Missing Config

```text
MOCK APIS
  No mock configs
  Expected: .fliwright/mocks/api/*.json

  Create Mock Config
```

MVP can create a minimal template only after explicit user action.

### 7.4 Invalid Config

```text
MOCK APIS
  ! get-token.example.json
    JSON parse error at line 18
```

Invalid rows remain visible. Apply commands are disabled for invalid entries.

### 7.5 Context Menu

API endpoint row:

- Apply Default Rule
- Open Mock Config
- Reveal in Explorer
- Copy Endpoint

API rule row:

- Apply Rule
- Preview Response Body
- Copy Rule JSON

Form rules row:

- Analyze Current Form With Rules
- Fill Current Form With Rules
- Open Form Rules
- Reveal in Explorer

---

## 8. Form Data View

Purpose: list `.fliwright/forms/*.json`, preview generated form data, and fill the current app screen.

Toolbar actions:

| Icon | Command | Tooltip |
|------|---------|---------|
| `symbol-field` | `fliwright.analyzeForm` | Analyze Current Form |
| `check` | `fliwright.fillForm` | Fill Current Form |
| `refresh` | `fliwright.reloadFormRules` | Reload Form Rules |
| `add` | `fliwright.createFormRules` | Create Form Rules |

### 8.1 Default State

```text
FORM DATA
  Rule Directory
    .fliwright/forms
    2 files · 7 rules

  form-rules.example.json
    3 rules · zh-CN
    label=手机号 REGEXP_MOCK
    label=邮箱 PRESET_SKILL
    hintText=请输入验证码 REGEXP_MOCK

  checkout-rules.json
    4 rules · zh-CN
```

### 8.2 Analyze Result

```text
FORM DATA
  Last Analyze
    4 fields · 3 fillable · 1 skipped
    email        alice.chen@example.com
    phone        13912345678
    password     skipped obscure field

  form-rules.example.json
    3 rules · zh-CN
```

### 8.3 Missing Rules

```text
FORM DATA
  No form rules
  Expected: .fliwright/forms/*.json

  Create Form Rules
```

### 8.4 Invalid Rules

```text
FORM DATA
  ! checkout-rules.json
    rule[2].pattern is required for REGEXP_MOCK
```

Invalid rows remain visible. Analyze can still run with built-in generators, but filling with invalid selected rules is disabled.

### 8.5 Context Menu

Form rules file row:

- Analyze Current Form With Rules
- Fill Current Form With Rules
- Open Form Rules
- Reveal in Explorer

Generated field row:

- Copy Generated Value
- Fill This Field
- Regenerate

---

## 9. Status Bar

Placement:

- Left side, near test/debug status if possible.
- Text starts with `Fliwright`.

States:

| State | Text | Command |
|-------|------|---------|
| Disconnected | `Fliwright: Disconnected` | Connect |
| Connecting | `Fliwright: Connecting...` | Open Output |
| Connected | `Fliwright: Connected` | Show connection quick pick |
| Running | `Fliwright: Running tests...` | Open Runs |
| Recording | `Fliwright: Recording` | Open Recording Panel |
| Failed run | `Fliwright: 1 failed` | Open Runs |
| Healed run | `Fliwright: 1 healed` | Open Runs |

Use VS Code ThemeColor state colors only. Do not hardcode red/green values in extension-host UI.

---

## 10. CodeLens

Show CodeLens only in files that import `@fliwright/vitest`.

At file top:

```text
Run Fliwright File | Record New Flow
```

Above each test block when detectable:

```text
Run Test | Run With Failure Context
```

Rules:

- If disconnected, command first prompts for VM Service URL.
- If test discovery cannot map a CodeLens to a test name safely, run the file.
- Keep labels short and action-oriented.

---

## 11. Failure Context Webview

Purpose: make a failed or healed test actionable in one screen.

### 13.1 Desktop Layout

For editor widths >= 900px:

```text
+--------------------------------------------------------------------------------+
| cart updates quantity                                            Failed · 450ms |
| tests/cart.test.ts:42                              [Open Source] [Copy JSON]    |
+--------------------------------------------------------------------------------+
| Assertion                                                                      |
| toBeVisible expected visible, got not found after 5000ms                       |
+----------------------------------------+---------------------------------------+
| Screenshot                             | Repair                                |
| +------------------------------------+ | + Suggested selector                  |
| |                                    | | | text=Qty: 2                         |
| |         device screenshot          | | | Confidence 0.92                     |
| |                                    | | | position .95 context .88 text .93   |
| +------------------------------------+ | [Copy Selector] [Preview Diff]        |
+----------------------------------------+---------------------------------------+
| Source                                                                         |
| await expect(page.locator({ text: 'Qty: 2' })).toBeVisible();                  |
+--------------------------------------------------------------------------------+
| Widget Tree                                                     [Collapse All]  |
| {                                                                              |
|   "type": "Scaffold",                                                          |
|   "children": [...]                                                            |
| }                                                                              |
+--------------------------------------------------------------------------------+
```

### 13.2 Narrow Layout

For editor widths < 900px:

```text
cart updates quantity
Failed · 450ms

[Open Source] [Copy JSON]

Assertion
...

Repair
...

Screenshot
...

Source
...

Widget Tree
...
```

### 13.3 Sections

Header:

- Test name.
- Status pill: Failed, Healed, Passed with warning.
- Duration.
- Source file and line.

Assertion:

- Matcher.
- Expected/actual.
- Timeout.
- Error message first line.

Screenshot:

- Use actual device screenshot if present.
- If absent, show an empty state:

```text
No screenshot captured
Check fliwright.screenshotMode
```

Repair:

- Original selector.
- Suggested selector.
- Confidence as text and a compact bar.
- Score breakdown.
- Actions:
  - Copy Selector.
  - Preview Diff.
  - Open Source.

Source:

- Single focused snippet.
- No full file rendering.

Widget Tree:

- JSON tree with collapsible nodes.
- Search box.
- Copy selected node.

### 13.4 Visual Rules

- No decorative cards. Use full-width sections separated by 1px VS Code border color.
- Header remains sticky inside the Webview.
- Buttons use VS Code button styles and Codicons when useful.
- Monospace only for selectors, snippets, JSON, and URLs.
- Long selector strings wrap; do not overflow horizontally.

---

## 12. Recording Webview

Purpose: record a manual flow and turn it into a test file.

### 13.1 Idle State

```text
+------------------------------------------------------------------+
| Recording                                                        |
| Connected to ws://127.0.0.1:8181/ws                              |
|                                                                  |
| [Start Recording]                                                |
|                                                                  |
| Generated tests will use @fliwright/vitest and the current app.  |
+------------------------------------------------------------------+
```

### 13.2 Recording State

```text
+------------------------------------------------------------------+
| Recording                                             00:12       |
| ● Listening to device input                                      |
|                                                                  |
| Raw events        18                                             |
| Operations         4                                             |
| Last operation     tap text=Login                                |
|                                                                  |
| [Stop Recording]                                                 |
+------------------------------------------------------------------+
```

Rules:

- Timer updates once per second.
- Counters are informational; no charting in MVP.
- Stop button is primary.
- Status Bar also shows `Fliwright: Recording`.

### 13.3 Preview State

```text
+--------------------------------------------------------------------------------+
| Recording Preview                                         6 operations          |
| [Insert in Active Editor] [Create Test File] [Copy Code] [Record Again]         |
+--------------------------------------------------------------------------------+
| test('recorded test', async ({ page }) => {                                     |
|   await page.locator({ text: 'Email' }).type('alice@test.com');                 |
|   await page.locator({ text: 'Login' }).tap();                                  |
| });                                                                            |
+--------------------------------------------------------------------------------+
| Operations                                                                     |
| 1 tap        text=Email                                                        |
| 2 type       alice@test.com                                                    |
| 3 tap        text=Login                                                        |
+--------------------------------------------------------------------------------+
```

Code preview:

- Use editor-like monospace rendering.
- Provide copy and insert actions.
- Do not auto-create files.

### 13.4 Error State

```text
Recording unavailable
The running app does not expose ext.fliwright.startRecording.

[Open Setup Help] [Retry]
```

---

## 13. Trace Viewer Webview

MVP trace is a compact run inspector, not a full playback engine.

### 13.1 Layout

```text
+--------------------------------------------------------------------------------+
| Trace: Latest Run                                  5 tests · 1 failed · 1.7s    |
+-----------------------------+--------------------------------------------------+
| Timeline                    | Details                                          |
| ✓ login shows form 120ms    | Selected: cart updates quantity                  |
| ✓ login rejects 340ms       |                                                  |
| ✗ cart updates 450ms        | Assertion                                        |
| ✓ cart removes 210ms        | Screenshot                                       |
|                             | Failure JSON                                     |
+-----------------------------+--------------------------------------------------+
```

Behavior:

- Timeline selection updates the detail pane.
- Failed items have direct `Open Failure Context`.
- Passed items show duration and source if available.

V1 trace additions:

- Step-by-step operation replay.
- Screenshot sequence.
- Network/mock timeline.
- Self-healing decision trail.

---

## 14. Form Helper UI

Use Quick Pick for MVP instead of a dedicated Webview.

Analyze flow:

1. Command: `Analyze Current Form`.
2. Extract fields through `ext.fliwright.extractForm`.
3. Load selected `.fliwright/forms/*.json` rules, or use the configured rules directory.
4. Show generated values without mutating the app.

```text
Analyze Current Form
email        email        alice.chen@example.com
phone        phone        13912345678
code         text         482915

[Fill Form] [Regenerate] [Open Rules]
```

Fill flow:

1. Command: `Fill Current Form`.
2. Extract fields.
3. Show preview Quick Pick with generated values when `fliwright.formPreviewBeforeFill` is enabled.
4. Fill selected fields through existing locator/type APIs.

```text
Fill Current Form
✓ email       alice.chen@example.com
✓ phone       13912345678
✓ password    ************

[Fill Form] [Regenerate]
```

Rules:

- Sensitive-looking values are masked in preview.
- User can deselect fields before filling.
- `Regenerate` runs the form-helper again.
- If no fields are found, show a short notification and log details.
- Obscure/password fields are skipped by default.
- Generated values are local only and must not be logged unless explicitly revealed by the user.

---

## 15. Settings UI

Use native VS Code Settings.

Important settings should also be discoverable from view empty states:

- VM Service URL.
- Test glob.
- Runner.
- Screenshot mode.
- Mock directory: `.fliwright/mocks`.
- Mock index: `.fliwright/mocks/mock-index.json`.
- Form rules directory: `.fliwright/forms`.
- Form locale.

Quick pick for connection:

```text
Connect to VM Service
> ws://127.0.0.1:8181/ws        Recent
  ws://127.0.0.1:54321/ws       Discovered
  Enter URL manually...
```

---

## 16. Notifications and Output

Notifications:

- Use only for blocking errors or completed long-running actions.
- Include one primary action when useful.

Examples:

| Scenario | Notification |
|----------|--------------|
| No VM URL | `No Flutter VM Service found.` Actions: `Discover`, `Enter URL` |
| Run complete failed | `Fliwright run failed: 1 test failed.` Action: `Open Runs` |
| Recording stopped | `Recorded 6 operations.` Action: `Preview` |
| Sandbox applied | `Applied 3 mock routes.` |
| Mock config invalid | `Mock config has validation errors.` Action: `Open Output` |
| Form filled | `Filled 4 fields, skipped 1.` Action: `Show Details` |

OutputChannel:

- Name: `Fliwright`
- Contains command args, process output, parse errors, VM connection details.
- Never show secrets from mock bodies or form values by default.

---

## 17. Webview Visual System

Use VS Code CSS variables:

```css
body {
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

button {
  color: var(--vscode-button-foreground);
  background: var(--vscode-button-background);
}

.secondary {
  color: var(--vscode-button-secondaryForeground);
  background: var(--vscode-button-secondaryBackground);
}

.bordered {
  border-color: var(--vscode-panel-border);
}

code,
pre {
  font-family: var(--vscode-editor-font-family);
}
```

Spacing:

| Token | Value |
|-------|-------|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-6` | 24px |

Typography:

| Use | Size |
|-----|------|
| Webview body | VS Code default |
| Header title | 18px |
| Section title | 13px, 600 weight |
| Metadata | 12px |
| Code/JSON | editor font |

Layout:

- Use CSS grid for Failure and Trace panels.
- Collapse to single column below 900px.
- Keep minimum content width at 320px.
- Never require horizontal scrolling except inside code/JSON blocks.

---

## 18. Accessibility

Requirements:

- All commands must be reachable through Command Palette.
- Webview controls must be keyboard reachable.
- Buttons need explicit labels, not icon-only labels in Webviews.
- Tree items need meaningful labels and descriptions.
- Color must not be the only status indicator.
- Screenshots need adjacent textual failure context.
- JSON tree search input must have a label.
- Respect high-contrast themes through VS Code variables.

Keyboard shortcuts:

- Do not claim global shortcuts in MVP.
- Provide command IDs so users can bind shortcuts themselves.

---

## 19. UI Copy

Tone:

- Short, operational, concrete.
- Avoid explaining Fliwright concepts inline unless the user is blocked.

Preferred copy:

| Instead of | Use |
|------------|-----|
| `Something went wrong` | `Connection failed` |
| `Please configure the app correctly` | `Bridge extension is missing` |
| `Start using Fliwright by...` | `Connect to VM Service` |
| `AI self-healing found a possible component` | `Suggested selector` |

Empty states should include the next action:

```text
No Fliwright tests found
Pattern: tests/**/*.test.ts

Create Example Test
```

---

## 20. Implementation Mapping

| UI Surface | Planned File |
|------------|--------------|
| Activity container contribution | `packages/fliwright-vscode/package.json` |
| Status Bar | `src/extension.ts` or `src/views/StatusBar.ts` |
| Devices Tree | `src/views/DevicesTreeProvider.ts` |
| Tests Tree | `src/views/TestsTreeProvider.ts` |
| Runs Tree | `src/views/RunsTreeProvider.ts` |
| Mock APIs Tree | `src/views/MockApiTreeProvider.ts` |
| Form Data Tree | `src/views/FormDataTreeProvider.ts` |
| Failure Webview | `src/webview/FailurePanel.ts`, `media/webview.js`, `media/main.css` |
| Recording Webview | `src/webview/RecordingPanel.ts`, `media/webview.js`, `media/main.css` |
| Trace Viewer | `src/webview/TraceViewerPanel.ts`, `media/webview.js`, `media/main.css` |
| CodeLens | `src/views/FliwrightCodeLensProvider.ts` |

---

## 21. MVP UI Checklist

- Devices view shows disconnected, connecting, connected, and error states.
- Tests view discovers files and exposes run actions.
- Runs view shows latest pass/fail/healed summaries.
- Failure Webview supports source opening, JSON copy, selector copy, and diff preview entrypoint.
- Recording Webview supports idle, recording, preview, and error states.
- Mock APIs view supports missing config, loaded config, invalid config, and active routes.
- Form Data view lists form rule files and last analyze/fill results.
- Form helper uses Quick Pick preview with selectable fields.
- Status Bar reflects connection, running, recording, failed, and healed states.
- All webviews work at 320px, 900px, and wide editor widths.
- UI uses VS Code theme variables only.
- All detailed diagnostics are available in the OutputChannel.
