# @fliwright/cli

The primary command-line interface for Fliwright Flutter E2E automation.

```sh
npx fliwright init
flutter run -t test_driver/fliwright_app.dart
npx fliwright run
```

Use `fliwright doctor` to diagnose the Node, Flutter, bridge, and VM Service
setup. CI should use `fliwright run --reporter junit` or a JSON reporter and
rely on the process exit code.

The stable product surface is CLI-first:

- `fliwright app` observes and drives a running Flutter application.
- `fliwright scenario` prepares deterministic named test state.
- `fliwright mock` manages mock rules and recorded calls.
- `fliwright artifacts` inspects or exports structured run evidence.
- `fliwright record` converts live interactions into test code.
- `fliwright mcp` configures or starts the optional coding-agent adapter.

Persistent TDD and Flow/Figma commands are Labs features. MCP is not required
to initialize a project, run tests, produce CI exit codes, or read artifacts.

Only enable `fliwright_bridge` in trusted debug or test builds.
