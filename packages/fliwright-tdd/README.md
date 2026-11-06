# @fliwright/tdd

Experimental persistent focused-test execution and Flutter synchronization for
Fliwright. This package is published under the npm `next` tag while its Flutter
daemon and restart compatibility matrix is validated.

Most users should begin with `@fliwright/cli` and `@fliwright/vitest`. TDD
commands are available under `fliwright tdd`.

The agent follows the TDD skill: author a normal test, confirm its expected
failure, implement the behavior, then refactor and run regressions. This package
provides app reload/restart, baseline reset, focused reruns, connection lifecycle
and execution evidence. It does not generate acceptance tests, maintain a TDD
readiness state machine, infer requirements or perform AI repairs.

Use `fliwright run` for one-shot verification. For repeated work, open a session,
start the runtime if attaching, explicitly focus an authored test and request
cycles as needed. `testName` is literal; full names use `Suite > test`. A file
run aggregates all executed tests and suite errors. Named composed scenarios are
prepared by Vitest fixtures before every attempt and retry.

This revision removes `tdd.prepare`, `tdd.validate-spec`, `tdd.repair`,
`devassist.cycle`, red-first generation APIs and their workflow metadata.
Author tests through the skills and use `tdd.focus` plus `tdd.cycle` to execute.

For direct API consumers, `Scenario` / `setScenario` become `BaselineConfig` /
`setBaselineConfig` for low-level resets. Select a declared `TestScenario` by name
with `defaultScenario` or `setDefaultScenario(name)`; fixtures prepare it per
attempt. The executor no longer accepts the unused `driverProvider` boot option;
workers connect through the VM-service URL.
