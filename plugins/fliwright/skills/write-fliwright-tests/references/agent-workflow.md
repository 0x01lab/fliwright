# Agent workflow

Use the `fliwright-cli-workflows` Skill for command discovery and session/CI workflow.

1. Inspect `fliwright schema --json` and the selected command schema.
2. Read the app with `app snapshot` and `app observe`; use stable query locators in durable tests.
3. Record with a finite `record --duration` or generate a draft with `generate-test --input`.
4. Prepare a named composed scenario and run `run --scenario <name> --json`.
5. Diagnose through offline `artifacts failures`, `artifacts timeline`, and `artifacts show`.
6. Read readiness and evidence before accepting generated tests; retain CI artifacts on failure.

Use `session open` and explicit `--session` for repeated exploration or persistent TDD, and close it when done.
