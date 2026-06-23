# Driver Ownership Spike — 2026-06-22

Verdict: PASS for the additive API surface.

`@fliwright/vitest` now accepts:

```ts
createFliwrightTest(config, { driverProvider })
```

When supplied, the `driver`, `page`, and `aiRuntime` fixtures resolve the driver through the provider
instead of the module-level shared driver. The default call path is unchanged.

Automated proof lives in
`packages/fliwright-vitest/tests/create-fliwright-test.driverProvider.test.ts`: a fliwright test
created with a stub provider runs through the page fixture and asserts that the provider is called.

The longer connect-once proof across persistent in-process reruns still depends on wiring a real
TDD fixture config into `PersistentTestExecutor` in Plan 2, but the risky `@fliwright/vitest`
extension point is in place and opt-in.
