# Troubleshooting & Common Repairs

Symptom → cause → fix. When in doubt, run `fliwright doctor --vm-url …` first.

## Connection / VM URL

| Symptom | Cause | Fix |
| --- | --- | --- |
| `No VM Service URL provided` | neither `FLIWRIGHT_VM_URL` nor `FLIWRIGHT_VM_SERVICE_URL` set | export the URL, or `createFliwrightTest({ vmServiceUrl })` |
| connection error on a raw-driver script | `flutter run` printed an **HTTP** URL; `connect()` needs WS | convert: `url.replace('http://','ws://')` and append `/ws` (the fixture does this for you) |
| `Could not find a running Flutter VM Service` (CLI) | no app running, no `--vm-url`, discovery found nothing | start the app (`flutter run`), then re-run; or pass `--vm-url` |
| suite silently does nothing | test wrapped in `describe.skipIf(!vmUrl)` / `test.skipIf(!vmUrl)` | export the VM URL so the guard passes |

## Bridge readiness (most common class of failure)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unknown method "ext.fliwright.snap"` | app runs an **older** bridge | upgrade `fliwright_bridge`, call `FliwrightBridge.init()` in `kDebugMode`, rebuild/restart, confirm `ext.fliwright.snap` works |
| `Unknown method "ext.fliwright.extractForm"` | older bridge lacks form extraction | upgrade; meanwhile fall back to raw-driver legacy paths (label them) |
| `snapshot()`/`findRef()`/`fliwright_snap` fail | same older-bridge issue | upgrade before using snap/ref/observe/actionability features |
| mock rules don't affect the app | `route()` silently fell back to the tool-side mirror | use `routeFlutter()` (strict) or upgrade the bridge so the Flutter store is used |

**Upgrade direction:** depend on the current `fliwright_bridge`, initialize `FliwrightBridge.init()`
behind `kDebugMode`, rebuild/restart, confirm `ext.fliwright.snap` works, then run the suite. Do not
keep running against an older, crashing, or unstable app.

## Selectors / flakiness

| Symptom | Cause | Fix |
| --- | --- | --- |
| `tap failed` with a `contextDump` list | selector didn't resolve; the dump shows what's actually on screen | read the dump, switch to key/semantics, or scope with `.and()`/`.filter()` |
| matches the wrong widget (ambiguous text) | `getByText('Submit')` matched several | scope to a parent, add `.and({ type })`, use semantics role, or `.filter({ enabled: true })` |
| first-match instability | `.nth(0)` / first-match flips between runs | pin with key/semantics; use `.filter({ text })` or position filtering |
| ref works once then fails | committed a hard-coded `e<N>` ref (ephemeral per snapshot) | capture snapshot in the same run, or commit a `findRef({...})` / `getBySemantics(...)` query |
| stale element after navigation | selector matched a widget from the previous page mid-transition | `waitForNew(selector)` instead of `waitFor`/`locator` |
| fill lands in the wrong field | broad `getByType('TextField')` | `formHelper.analyze()` then match by `selector`, or use `getByKey`/semantics |

### Read the `contextDump`

When an action fails to find its target, the thrown error appends up to 10 visible widgets:

```
tap failed debug=…

Visible widgets on screen:
  - ElevatedButton "Submit" [key=submit] role=button
  - TextField "Email" semantics="Email address"
```

This list is the fastest path to the right selector. Use it.

## Timing / stability

| Symptom | Cause | Fix |
| --- | --- | --- |
| intermittent failure after a click that triggers navigation | queried the new page during the transition | `click({ waitForAnimations: true })` or `page.settle()`, then `waitFor`/`expect` |
| assertion flaps on slow network | default 5s timeout too short | `expect(loc).toBeVisible({ timeout: 15_000 })` or `waitForNetworkIdle()` |
| screenshot assertions fail / blank screen | app mid-frame or PlatformView not painted | wait for a stable frame / restart; use `screenshot({ mode: 'canvas' })` for WebView |
| test depends on fixed `sleep` | hidden timing coupling | replace with `waitFor` / auto-wait `expect` / `settle` |

**If a live app crashes or enters an unstable state, stop E2E immediately.** Don't keep clicking
through a broken screen. Restart/rebuild the app first.

## Mocks

| Symptom | Cause | Fix |
| --- | --- | --- |
| routes bleed between tests | shared driver retains previous routes | start each mock test with `await driver.mock.clear(); await driver.mock.clearCalls();` |
| unmatched route hits real network | passthrough defaults on | `setPassthrough(false)` after `clear()` (then unmatched → 404) |
| `getCalls()` body assertions fail | Dio sends JSON as a string | `JSON.parse(call.body)` before asserting fields |
| `routeFlutter()` throws | Flutter store rejected the route / extension missing | upgrade bridge, or accept the `route()` fallback for non-UI probes |

## Forms

| Symptom | Cause | Fix |
| --- | --- | --- |
| `formHelper.analyze()` returns `[]` | older bridge lacks `ext.fliwright.extractForm` | upgrade bridge; legacy scripts use raw `ext.fliwright.extractForm` |
| `fill()` skips a field you expected filled | `skipObscureFields: true`, or field's semantic type inferred as `password` | pass `skipObscureFields: false`, or fill that field explicitly by key |
| wrong semanticType inferred | hintText substring collision (e.g. "邮箱地址".includes("地址")) | match by `selector` not by hintText substring; add a `.fliwright/forms/*.json` rule |
| `fillFields(['手机号'])` matches nothing | hint didn't match any field's hintText/label/name/semanticsId | `analyze()` first, copy the exact `hintText`/`selector` |

## Environment checks

- `fliwright doctor --vm-url …` validates versions, package resolution, config, and **live bridge
  capabilities**. Run it first when something's off.
- `echo $FLIWRIGHT_VM_URL` is non-empty and points at the running app.
- The app exposes the **current** bridge (`ext.fliwright.snap` responds).
- `.fliwright/` exists with `forms/` and `mocks/` (`fliwright init` creates it).

## Escalation order

1. Read the failure's `contextDump` / `widgetTree` / `source`.
2. `fliwright doctor --vm-url …` for capability/version checks.
3. `fliwright_snap` / `page.snapshot()` to see the current tree.
4. Harden the selector (key/semantics/scope) or wait primitive.
5. If the app itself is unstable/crashing → restart/rebuild before more E2E.
