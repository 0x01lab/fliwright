# API 速查

单页签名速查表。需要讲解/示例请参考各专题链接。所有签名均取自当前源码 —— 若有冲突，以源码为准。

## `@fliwright/vitest` 导出

```typescript
import { test, expect, createFliwrightTest, defineConfig,
         createFliwrightScript, script,
         beforeEach, afterEach, beforeAll, afterAll, describe } from '@fliwright/vitest';

// fixture: test('name', async ({ page, driver, flow, mock, agent, aiRuntime, timeline, logger }) => {})
// fixture: script('name', async ({ page, driver, flow, mock, agent, aiRuntime, timeline, logger }) => {})
// expect(locator, title?): Assertion    // auto-wait + healing + timeline assertion
// createFliwrightTest(config): test     // custom config
// createFliwrightScript(config): script // mode='script', requireAssertions=false
// defineConfig(overrides & { vmServiceUrl }): FliwrightConfig   // fills defaults
//   FliwrightConfig { vmServiceUrl; timeout?: 5000; screenshot?: 'file'|'base64'|'off';
//                     ai?; mode?: 'test'|'script'; requireAssertions?; agentPolicy?; timelineDir?; runsRoot?; log? }
```

环境变量：`FLIWRIGHT_VM_URL`、`FLIWRIGHT_VM_SERVICE_URL`、`FLIWRIGHT_RUNS_ROOT`、`FLIWRIGHT_SCREENSHOT_MODE`、
`FLIWRIGHT_FAILURE_TIMEOUT_MS`、`FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH`、
`FLIWRIGHT_MOCK_CONTROLLER_URL`、`FLIWRIGHT_TRACE`、`FLIWRIGHT_TRACE_DIR`、
`FLIWRIGHT_LOG_LEVEL`、`FLIWRIGHT_LOG_FORMAT`、`FLIWRIGHT_LOG_OUTPUT`、
`FLIWRIGHT_LOG_FILE`、`FLIWRIGHT_LOG_JSONL`。

## Timeline Fixtures

```typescript
// flow — Timeline node grouping and artifacts
flow.step(title, body, metadata?)
flow.page(title, { route?, metadata? }, body)
flow.page(title, body)
flow.branch(title, metadata, body)
flow.optional(title, { when? }, body)
flow.frame(title, { screenshot?, snapshot?, diagnostics?, metadata? })
flow.manual(title, { message?, timeoutMs?, pollIntervalMs?, metadata?, resumeWhen? })
flow.assertion(title, body, metadata?)

// mock — timeline-aware facade over driver.mock
mock.rules(title, body)
mock.loadRules(mockDir?)
mock.switchRule(endpoint, ruleName, method?)
mock.route(path, response & { method?, id? })
mock.routeFlutter(path, response & { method?, id? })
mock.removeRoute(path, method?)
mock.clearRoutes()
mock.clearCalls()
mock.setPassthrough(enabled)
mock.getCalls(path?)
mock.listRoutes()
mock.listRules()
mock.findCalls({ method?, path?, url?, headers?, body? })

// agent — explicit AI calls recorded as ai-call timeline nodes
agent.ask(titleOrPrompt, request?)
agent.generate<T>(titleOrPrompt, { schema?, fallback?, prompt? })
agent.verify(prompt, { includeScreenshot?, includeSnapshot?, timeoutMs? })
agent.inspect<T>(titleOrPrompt, { schema?, prompt?, includeScreenshot?, includeSnapshot? })

// logger — structured run logs
logger.trace(message, data?)
logger.debug(message, data?)
logger.info(message, data?)
logger.warn(message, data?)
logger.error(message, error?, data?)
logger.success(message, data?)
```

## `page` — `Page`

```typescript
// Locators
page.locator(selector): Locator
page.find(query): Locator
page.getByText(text, opts?): Locator          // { exact?, match?, caseSensitive? }
page.getByKey(key): Locator
page.getByType(type): Locator
page.getBySubtype(subtype): Locator
page.getBySemantics(sem): Locator             // { identifier?, label?, hint?, role?, match?, caseSensitive? }
page.getByTooltip(tooltip): Locator
page.ref(ref): Locator
page.findRef(query): Promise<Locator>         // { text?, containsText?, key?, semanticsLabel?, role?, type? }

// Waiting
page.waitFor(selector, timeoutMs?=5000): Promise<Locator>
page.waitForNew(selector, opts?): Promise<Locator>     // { timeout? }
page.settle(opts?): Promise<void>                       // { timeout? } default 2000
page.waitForNetworkIdle(opts?): Promise<void>           // { quietMs?, timeout? }
page.dismissModal(): Promise<void>

// Navigation (requires router in FliwrightBridge.init)
page.navigate(path, opts?): Promise<void>     // { extra? }
page.currentRoute(): Promise<string>
page.goBack(): Promise<void>

// Screenshots / snapshots
page.screenshot(opts?): Promise<Buffer>       // { pixelRatio?, mode?: 'auto'|'boundary'|'canvas', rect? }
page.screenshotFullPage(opts?): Promise<Buffer>   // { pixelRatio? }
page.snapshot(opts?): Promise<AgentSnapshotResult> // { depth?, includeRects?, includeProperties? }

// Raw coordinates (outside widget tree)
page.clickAt(x, y): Promise<void>
page.dragFrom(x, y, deltaX, deltaY, opts?): Promise<void>   // { steps? }

// Forms
page.formHelper.analyze(opts?): Promise<FormAnalyzeResult>
page.formHelper.fill(opts?): Promise<FormFillResult>
page.formHelper.fillFields(hints[], opts?): Promise<FormFillResult>
//   FormHelperOptions { scope?, skipObscureFields?, locale?, rulesPath? }
```

## `locator` — `Locator`

```typescript
// Construction / scoping (return new Locator)
loc.locator(selector): Locator                 // descendant
loc.getByText / getByKey / getByType / getBySubtype / getBySemantics / getByTooltip
loc.ancestor(selector): Locator
loc.and(...selectors): Locator
loc.or(...selectors): Locator
loc.nth(index, opts?): Locator                 // { visible? }
loc.first(opts?): Locator                      // { visible? }
loc.last(opts?): Locator                       // { visible? }
loc.filter(criteria: FilterCriteria): Locator
loc.containing(descendant): Locator

// Gestures / input (Promise<void>)
loc.click(opts?)                  // { alignment?, timeout?, waitForAnimations?, settleTimeout? }
loc.doubleClick(opts?) / tripleClick(opts?) / rightClick(opts?)   // { alignment?, timeout? }
loc.hover(opts?) / focus(opts?)                                   // { alignment?, timeout? }
loc.blur(opts?)                                                   // { timeout? }
loc.longPress(opts?)              // { duration?, alignment?, timeout? }
loc.drag(deltaX, deltaY, opts?)   // { steps?, alignment?, timeout? }
loc.dragTo(direction, distance?, opts?)  // 'left'|'right'|'up'|'down'
loc.slideTo(targetX, opts?)       // slider/captcha
loc.pinch(scale, opts?)
loc.type(text, opts?)             // { delay?|charDelay?, timeout? }  append
loc.fill(text, opts?)             // { delay?|charDelay?, timeout? }  replace
loc.clear(opts?)                  // { timeout? }
loc.pressKey(key, opts?)          // { timeout? }
loc.setCheckbox(checked, opts?)   // { timeout? }
loc.selectOption(value, opts?)    // string|number
loc.scrollIntoView(opts?)         // { alignment?=0.5, duration?=300, timeout? }

// Read (no side effect)
loc.count(): Promise<number>
loc.isVisible(): Promise<boolean>
loc.resolve(): Promise<WidgetInfo | undefined>
loc.resolveAll(opts?): Promise<WidgetInfo[]>    // { visible?: 'any'|'hitTestable', strict?, limit? }

// Fast path on pre-resolved widget
loc.fillWithResolved(text, resolved, opts?): Promise<void>
loc.clickResolved(resolved): Promise<void>
```

## `expect` — `Assertion`

```typescript
expect(locator, title?): Assertion
// matchers (options?: { timeout?=5000, title?, includeScreenshot?, includeSnapshot? })
.toBeVisible(options?)
.toHaveText(text, options?)
.toContainText(text, options?)
.toBeEnabled(options?)
.toBeDisabled(options?)
.not          // negation (disables healing)
// raw Vitest for non-locator checks:
import { expect as viExpect } from 'vitest'
```

## `driver.mock` — `MockManager`

```typescript
driver.mock.route(path, response): Promise<void>          // best-effort sync to Flutter store
driver.mock.routeFlutter(path, response): Promise<unknown> // strict (no silent fallback)
driver.mock.addRoute(path, response): Promise<void>        // alias of route
driver.mock.removeRoute(path, method?): Promise<void>
driver.mock.clear(): Promise<void>
driver.mock.clearCalls(): Promise<void>
driver.mock.setPassthrough(enabled): Promise<void>
driver.mock.getCalls(path?): Promise<MockCall[]>
driver.mock.listRoutes(): Promise<{ id, method?, path }[]>
driver.mock.loadRules(mockDir?= '.fliwright/mocks'): Promise<void>
driver.mock.listRules(): { endpoint, method, rules[], activeRule }[]
driver.mock.switchRule(endpoint, ruleName, method?): Promise<void>
driver.mock.startServer(opts?) / stopServer()
driver.mock.controllerUrl: string | null
// MockRouteResponse { status, body, headers?, delay?, method? }
```

## `driver` — `FliwrightDriver`（原始 / 高级用法）

```typescript
new FliwrightDriver(options?: { plugins?: FliwrightPlugin[] })
driver.connect(vmServiceUrl): Promise<void>     // needs ws://…/ws
driver.dispose(): Promise<void>
driver.page / driver.mock / driver.healing / driver.recorder / driver.state / driver.app
driver.sdkVersion: string | null
driver.sendRequest(method, params?): Promise<unknown>
driver.reloadSources(): Promise<unknown>
driver.listenToDiagnostics(streamIds?): Promise<void>
driver.getDiagnostics(opts?): VMServiceEvent[]
driver.clearDiagnostics(): void
driver.getStateAdapter(name) / getMockAdapter(name) / getFinderStrategy(name) / getHealingStrategy(name)
driver.notifyTestStart(name) / notifyTestEnd(name, result)
```

## `driver.app` — `AppInstance`

```typescript
driver.app.info(): Promise<AppInfo>                                     // ext.fliwright.app.info
driver.app.getSnapshot<T>(): Promise<AppSnapshot & { snapshot: T }>     // ext.fliwright.app.snapshot
driver.app.listCapabilities(): Promise<AppCapabilityDescriptor[]>       // ext.fliwright.app.capabilities
driver.app.hasCapability(name): Promise<boolean>
driver.app.getCapability<T>(name): Promise<AppCapabilityProxy<T> | undefined>
driver.app.invoke<TIn, TOut>(capability, method, input?): Promise<TOut> // ext.fliwright.app.invoke
driver.app.capability<T>(name): AppCapabilityProxy<T>   // typed proxy: anyMethod(input) -> invoke(name, 'anyMethod', input)
//   AppInfo { id; name?; environment?; capabilities: string[] }
//   AppCapabilityDescriptor { name; description?; methods: string[] }
//   AppCapabilityProxy<T> = T & { invoke(method, input?): Promise<unknown> }
```

## `fliwright` CLI

```text
fliwright run   [--test <p>] [--test-name <p>] [--vm-url <url>] [--reporter pretty|json|ai-json|junit]
                [--timeout <ms>] [--screenshot file|base64|off] [--output <file>]
fliwright init
fliwright doctor [--vm-url <url>]
fliwright record [--vm-url <url>] [--output <file>] [--lang ts|dart] [--name <n>]
                 [--home-route <route>] [--no-reset-home]
fliwright mock:start [--host <h>] [--port <p>] [--mock-dir <d>]
```

## 选择器字符串格式

`text=` · `textContains=` · `key=` · `type=`/`byType=` · `subtype=` · `tooltip=` · `semantics=`
· `role=` · 纯字符串（精确匹配文案） · `RegExp`。

## Bridge 能力（所需扩展）

| 功能 | 扩展 |
| --- | --- |
| snapshot/findRef/snap/observe | `ext.fliwright.snap` |
| 所有 Locator 动作、可操作性 | `ext.fliwright.action` |
| resolve/count/isVisible | `ext.fliwright.resolve` |
| formHelper/extractForm | `ext.fliwright.extractForm` |
| screenshot | `ext.fliwright.screenshot` |
| mocks | `ext.fliwright.mock.*` |
| app 身份/能力 | `ext.fliwright.app.info` / `.snapshot` / `.capabilities` / `.invoke` |
| click/dragFrom（原始） | `ext.fliwright.click` / `ext.fliwright.dragFrom` |
| 导航 | `ext.fliwright.navigate` / `.currentRoute` / `.goBack` |
| settle | `ext.fliwright.settle` |
| 旧版扁平快照 | `ext.fliwright.snapshot`（较旧的 bridge） |
