# Agent-driven TDD

The agent owns red → green → refactor. Fliwright provides execution and saved
evidence; it does not infer requirements, decide whether a red is meaningful or
apply repairs. Author ordinary tests with
[write-fliwright-tests](../../write-fliwright-tests/SKILL.md).

1. Define one observable behavior and its acceptance assertion. Read the app's
   source and project memory to verify routes, Keys and request contracts.
2. Write or extend `.fliwright/tests/*.test.ts`. Compose named `TestScenario`
   declarations for deterministic setup; use app-owned `auth.seedLoggedIn` for
   authenticated business tests. Do not weaken an assertion to obtain green.
3. Run the narrowest test before implementing. Inspect the actual assertion and
   current attempt evidence. Compile errors, missing configuration, unsupported
   setup and transport failures do not establish the expected red.
4. Implement the minimum app change. Synchronize Flutter and rerun the same
   test. Fix the app until the original acceptance assertion passes.
5. Refactor only after green; rerun the same test, then the affected regression
   suite. A focused green does not establish that the rest of the suite passes.

For UI implementation with a Figma reference, also perform the
[screenshot-based UI review](visual-review.md) after the visual change and its
fixes. Functional assertions and a green test do not verify visual fidelity.

## Choose execution by need

For one run, use `fliwright run --test <file> --scenario <name> --json`. Open a
persistent session only when repeated inspection, synchronization and focused
reruns benefit from a retained runtime. Read the installed command schema before
using a flag; the references below describe the current lifecycle.

- Open an attach or managed [session](commands/command-session.open.md).
  Managed `session open --device-id` already starts the runtime. For attach,
  call [tdd start](commands/command-tdd.start.md) with the session ID.
- [Focus](commands/command-tdd.focus.md) the authored file explicitly. Optional
  `testName` is literal, including punctuation; a full name uses `Suite > test`.
  Omit it to run the selected file. Change focus when switching behavior slices.
- After a Dart edit, [cycle](commands/command-tdd.cycle.md) with explicit reload
  or restart, or `sync: auto` with the actual changed paths. Attach mode cannot
  hot restart; choose managed ownership when structural changes require it.
- Select a declared [scenario](commands/command-tdd.scenario.md) for future
  attempts. Fixtures apply it before each attempt, including retries.
- Inspect returned failure context and timeline. Use offline
  [artifact failures](commands/command-artifacts.failures.md) and
  [artifact timeline](commands/command-artifacts.timeline.md) for saved evidence.
  Distinguish missing behavior from environment or test-authoring failures.
- [Reconnect](commands/command-tdd.reconnect.md) after transport disruption.
  After a timeout or lost response, inspect session/operation status before
  starting another mutation. Reacquire UI refs after app restart.
- [Stop](commands/command-tdd.stop.md) the runtime and close the session when
  finished. Keep app retention explicit when it matters to the task.

For a finite sync-and-test operation, `tdd cycle --file <file>` starts and stops
its own runtime. Use `run` for broader regression verification. Persistent
execution is an optimization, not a prerequisite for TDD.
