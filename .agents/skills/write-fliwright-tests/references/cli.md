# CLI and CI

Read the [CLI task and command index](../../fliwright-cli-workflows/references/commands/index.md) for complete per-command guidance and examples; load only the relevant pages. Discover exact flags with `fliwright schema <command.path> --json`.

```sh
fliwright run --test .fliwright/tests/cart.test.ts --scenario cart-ready --json --junit-output artifacts/junit.xml
fliwright artifacts failures --json
fliwright artifacts timeline example --test-id example --attempt-id example --json
fliwright record --duration 15 --json
```

Use the process exit code and JSON `ok` together. Run artifacts are canonical files and remain readable offline. Upload run directories and JUnit XML with `if: always()` in CI. `run` selects a named scenario before every fixture attempt, including retries. Managed launches use `--device-id`; existing apps use `--vm-url` or project/env discovery. `--deadline` requests whole-command cancellation and waits for cleanup.
