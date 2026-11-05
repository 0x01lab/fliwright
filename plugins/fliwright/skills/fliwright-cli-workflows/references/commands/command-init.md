---
command: "init"
group: setup
status: implemented
source: packages/fliwright-cli/src/registry
---

# fliwright init

Initialize project dependencies, Flutter bridge scaffolding and optional project-local Codex Skills.

## When to use

Use init --agent codex --yes for one-command project integration, or rerun to add missing scaffold and update unmodified managed resources.

## Preconditions and behavior

- No live app required by the registry. Check command-specific runtime requirements below.
- No persistent session required. See usage for finite/session variants.
- install, node and flutter default to true. --install false still writes scaffold/Skills but reports pending dependencies.
- --agent codex requires pubspec.yaml and an existing App entrypoint under lib/ (default lib/main.dart); use --entrypoint for flavors. Node and Flutter setup must remain enabled. No Codex executable, marketplace registration or Fliwright checkout is needed in the target project.
- Skills and references ship inside the CLI tarball. .agents/skills/.fliwright-managed.json tracks original hashes: reruns update unchanged managed files and preserve/report customized or unmanaged same-name Skills. Commit the managed state with installed Skills for reproducible updates.
- AGENTS.md content outside its Fliwright markers is preserved. Malformed markers are rejected. Existing configuration and bridge entrypoints are retained; incompatible preset/import references are flagged for review.
- Init is noninteractive; --yes explicitly accepts defaults. Configuration conflicts produce status=needs-attention. Dependency installer failures exit 3 with INIT_INSTALL_FAILED and partial data. Installer progress goes to stderr, preserving one JSON stdout envelope.
- Review generated app integration and replace example widget names. configured means setup references and installation commands completed, not live/runtime verification; follow with doctor --strict against a running App.

## Input

| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |
| --- | --- | --- | --- | --- | --- |
| `install` | `--install` | boolean | no | — | Run dependency installation after scaffolding; effective default true. |
| `node` | `--node` | boolean | no | — | Prepare Node package tooling; effective default true. |
| `flutter` | `--flutter` | boolean | no | — | Prepare Flutter bridge integration when pubspec.yaml exists; effective default true. |
| `pm` | `--pm` | "npm" \| "pnpm" \| "yarn" \| "bun" | no | — | Package manager for init installation. If omitted it is detected. |
| `agent` | `--agent` | "codex" | no | — | Install the packaged Codex automation Skills into project .agents/skills and merge managed AGENTS.md instructions. Requires a Flutter project with Node/Flutter setup enabled. |
| `yes` | `--yes` | boolean | no | — | Explicitly select noninteractive initialization defaults. Init never prompts; unresolved configuration is reported in checks/nextSteps instead of overwritten. |
| `entrypoint` | `--entrypoint` | string | no | — | Existing App Dart entrypoint under lib/, e.g. lib/main_dev.dart. Defaults to lib/main.dart; --agent validates it before writing scaffold files. (minLength=1) |

Requiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.

## Examples

Examples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.

### Integrate Codex without prompts

```sh
fliwright init --agent 'codex' --yes 'true' --json
```

### Prepare Codex files without installing dependencies

```sh
fliwright init --agent 'codex' --install 'false' --entrypoint 'lib/main_dev.dart' --json
```

### Set up Node tooling only

```sh
fliwright init --flutter 'false' --pm 'pnpm' --json
```

## Result

With --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.

| Data field / variant | Meaning |
| --- | --- |
| created | New files. |
| updated | Existing files amended by setup. |
| skipped | Existing scaffold files or disabled setup steps. |
| commands | Dependency installation commands attempted. |
| status | configured or needs-attention; inspect checks even when the command exits 0. |
| runtimeVerified | Always false: initialization does not launch or verify an App. |
| checks | Installation completion and static preset/entrypoint reference checks with passed/pending states; these do not replace doctor or Dart analysis. |
| nextSteps | Actionable setup follow-ups and live verification commands. |
| agent | Selected agent, completely installed Skill names and preserved conflicting project paths. |

## Effects and failure handling

Registry effects: `project-files`, `dependency-install`. These are coarse declarations; the behavior section explains actual reads/writes.

Use [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.

## Exact input schema

```json
{
  "type": "object",
  "properties": {
    "install": {
      "type": "boolean"
    },
    "node": {
      "type": "boolean"
    },
    "flutter": {
      "type": "boolean"
    },
    "pm": {
      "type": "string",
      "enum": [
        "npm",
        "pnpm",
        "yarn",
        "bun"
      ]
    },
    "agent": {
      "type": "string",
      "enum": [
        "codex"
      ]
    },
    "yes": {
      "type": "boolean"
    },
    "entrypoint": {
      "type": "string",
      "minLength": 1
    }
  },
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

Refresh the installed contract with `fliwright schema init --json`. That command describes the envelope; it does not enforce a full command-specific data schema.

## Related commands

- [doctor](./command-doctor.md) — Check local tooling, configuration and the Flutter automation connection.
- [scenario list](./command-scenario.list.md) — List named scenarios declared in project configuration.
- [run](./command-run.md) — Run selected Vitest automation tests and save canonical run evidence.
- [Command index](./index.md)
