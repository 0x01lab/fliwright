import { commandDocs, commandGroup, groups } from '../packages/fliwright-cli/docs/command-guide.mjs';
import { parameterDocs, commandParameterDocs } from '../packages/fliwright-cli/docs/parameter-guide.mjs';

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const shellValue = (value) => typeof value === 'string' && /^\$[A-Z_]+$/.test(value) ? `"${value}"` : quote(value);
const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const flagFor = (definition, key) => definition.aliases?.[key] ?? key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
export const commandSummary = (path) => commandDocs[path].summary;
export const commandFile = (path) => `command-${path}.md`;
export function exampleInvocation(definition, example) {
  const args = definition.path.split('.');
  const structured = Object.values(example.input).some((value) => typeof value === 'object' && value !== null);
  if (structured) args.push('--input', `fliwright-${definition.path}-input.json`);
  else {
    for (const key of definition.positional ?? []) {
      if (example.input[key] !== undefined) args.push(String(example.input[key]));
    }
    for (const [key, value] of Object.entries(example.input)) {
      if (definition.positional?.includes(key)) continue;
      args.push(`--${flagFor(definition, key)}`, String(value));
    }
  }
  for (const [key, value] of Object.entries(example.common)) args.push(`--${key}`, String(value));
  args.push('--json');
  return { args, structured };
}
function exampleShell(definition, example) {
  const { args, structured } = exampleInvocation(definition, example);
  const prefix = structured ? `cat > ${quote(`fliwright-${definition.path}-input.json`)} <<'JSON'\n${JSON.stringify(example.input, null, 2)}\nJSON\n` : '';
  const command = args.map((value, index) => index < definition.path.split('.').length || value.startsWith('--') ? value : shellValue(value)).join(' ');
  return `${prefix}fliwright ${command}`;
}
function schemaType(schema) {
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  if (schema.anyOf) return schema.anyOf.map(schemaType).join(' | ');
  if (schema.type === 'array') return `array<${schemaType(schema.items ?? {})}>`;
  return Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type ?? 'unknown';
}
function constraints(schema) {
  return ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern']
    .filter((key) => schema[key] !== undefined).map((key) => `${key}=${schema[key]}`).join(', ');
}
function parameterDescription(definition, key, schema) {
  const text = commandParameterDocs[definition.path]?.[key] ?? schema.description ?? parameterDocs[key];
  if (!text) throw new Error(`Missing parameter explanation: ${definition.path}.${key}`);
  return text;
}
export function renderCommand(registry, definition) {
  const guide = commandDocs[definition.path];
  if (!guide) throw new Error(`Missing command guide: ${definition.path}`);
  const contract = registry.schema(definition.path);
  const fields = Object.entries(contract.input.properties ?? {});
  const table = fields.map(([key, schema]) => {
    const syntax = definition.positional?.includes(key) ? `positional ${key}` : `--${flagFor(definition, key)}`;
    const required = contract.input.required?.includes(key) ? 'yes' : 'no';
    const defaultValue = 'default' in schema ? JSON.stringify(schema.default) : '—';
    const bounds = constraints(schema);
    return `| \`${key}\` | \`${syntax}\` | ${cell(schemaType(schema))} | ${required} | ${cell(defaultValue)} | ${cell(parameterDescription(definition, key, schema))}${bounds ? ` (${cell(bounds)})` : ''} |`;
  }).join('\n');
  const live = definition.needsApp ? 'A running Flutter app with fliwright_bridge; attach with vmUrl/project configuration or use a connection session.' : 'No live app required by the registry. Check command-specific runtime requirements below.';
  const persistent = definition.needsSession ? 'An explicit connection session is required (--session or FLIWRIGHT_SESSION).' : 'No persistent session required. See usage for finite/session variants.';
  return `---\ncommand: ${JSON.stringify(definition.path)}\ngroup: ${commandGroup(definition.path)}\nstatus: implemented\nsource: packages/fliwright-cli/src/registry\n---\n\n# fliwright ${definition.path.replaceAll('.', ' ')}\n\n${guide.summary}\n\n## When to use\n\n${guide.use}\n\n## Preconditions and behavior\n\n- ${live}\n- ${persistent}\n${guide.notes.map((note) => `- ${note}`).join('\n')}\n\n## Input\n\n${fields.length ? `| JSON field | CLI syntax | Type / values | Required | Schema default | Meaning |\n| --- | --- | --- | --- | --- | --- |\n${table}` : 'No command-specific input fields.'}\n\nRequiredness/defaults above come from the input schema. Conditional requirements and effective implementation defaults are explained above; “—” means no Zod default. Every command also accepts [common options](./common.md#common-options). JSON keys use camelCase; flags use kebab-case. Positional fields are supplied positionally or in --input, not as flags.\n\n## Examples\n\nExamples assume a project with Fliwright installed. Replace app-specific keys, scenario/flow names and uppercase placeholders. For live examples, set VM_URL to your actual websocket endpoint; set SESSION_ID from session open where used.\n\n${guide.examples.map((example) => `### ${example.title}\n\n\`\`\`sh\n${exampleShell(definition, example)}\n\`\`\``).join('\n\n')}\n\n## Result\n\nWith --json, read the versioned envelope’s ok and data fields. The following describes data, not the outer envelope. “(data)” means a value returned directly, not a wrapper property.\n\n| Data field / variant | Meaning |\n| --- | --- |\n${Object.entries(guide.result).map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`).join('\n')}\n\n## Effects and failure handling\n\nRegistry effects: ${definition.effects.map((effect) => `\`${effect}\``).join(', ') || 'none'}. These are coarse declarations; the behavior section explains actual reads/writes.\n\nUse [exit codes and recovery](./common.md#exit-codes-and-recovery). Retain data on nonzero exit because it can contain failure evidence or partial results. Correct input errors before retrying; for session mutations query the operation journal before retrying an uncertain response.\n\n## Exact input schema\n\n\`\`\`json\n${JSON.stringify(contract.input, null, 2)}\n\`\`\`\n\nRefresh the installed contract with \`fliwright schema ${definition.path} --json\`. That command describes the envelope; it does not enforce a full command-specific data schema.\n\n## Related commands\n\n${guide.related.map((path) => `- [${path.replaceAll('.', ' ')}](./${commandFile(path)}) — ${commandDocs[path].summary}`).join('\n')}\n- [Command index](./index.md)\n`;
}
export function renderIndex(registry) {
  const definitions = [...registry.definitions.values()];
  return `---\npurpose: Progressive CLI command routing for Skills\n---\n\n# Fliwright CLI command index\n\n${definitions.length} commands, one page per leaf command. Read [common conventions](./common.md) once, then open only the relevant command pages. Parameters and schemas are generated from the command registry; semantic guidance is maintained with the CLI package.\n\n## Choose a workflow\n\n| Task | Start with | Next |\n| --- | --- | --- |\n| Set up a project | [init](./command-init.md) | [doctor](./command-doctor.md) |\n| Run CI and collect evidence | [run](./command-run.md) | [failures](./command-artifacts.failures.md), [export](./command-artifacts.export.md) |\n| Inspect and operate the app | [session open](./command-session.open.md), [snapshot](./command-app.snapshot.md) | [find](./command-app.find.md), [interact](./command-app.interact.md) |\n| Prepare repeatable state | [scenario list](./command-scenario.list.md) | [resolve](./command-scenario.resolve.md), [apply](./command-scenario.apply.md) |\n| Reproduce HTTP outcomes | [mock list](./command-mock.list.md) | [apply](./command-mock.apply.md), [calls](./command-mock.calls.md) |\n| Investigate failed attempts | [artifacts show](./command-artifacts.show.md) | [timeline](./command-artifacts.timeline.md), [diagnose](./command-artifacts.diagnose.md) |\n| Capture a human demonstration | [record](./command-record.md) | [flow get](./command-flow.get.md), [run](./command-run.md) |\n| Compare UI to Figma | [review bundle](./command-flow.review-bundle.md) | [runtime capture](./command-flow.review-capture-runtime.md), [Figma capture](./command-flow.review-capture-figma.md), [report](./command-flow.review-report.md) |\n| Create a test from intent | [validate spec](./command-tdd.validate-spec.md) | [generate-test](./command-generate-test.md) or [tdd prepare](./command-tdd.prepare.md) |\n| Develop with persistent TDD | [session open](./command-session.open.md) | [start](./command-tdd.start.md), [focus](./command-tdd.focus.md), [cycle](./command-tdd.cycle.md), [stop](./command-tdd.stop.md), [close](./command-session.close.md) |\n| Recover/cancel uncertain work | [session status](./command-session.status.md) | [cancel](./command-session.cancel.md) |\n\n${Object.entries(groups).map(([group, title]) => `## ${title}\n\n| Command | Purpose |\n| --- | --- |\n${definitions.filter((definition) => commandGroup(definition.path) === group).map((definition) => `| [${definition.path.replaceAll('.', ' ')}](./${commandFile(definition.path)}) | ${commandDocs[definition.path].summary} |`).join('\n')}`).join('\n\n')}\n`;
}
export const commonGuide = `---
purpose: Shared CLI invocation, result and recovery conventions
---

# CLI conventions

Use the project’s installed executable: pnpm exec fliwright or npx --no-install fliwright. Examples abbreviate this as fliwright. Run from the target project root, or set --cwd explicitly. Read only the relevant pages in the [command index](./index.md).

## Common options

| Flag | Meaning |
| --- | --- |
| --cwd <directory> | Project root for config, sessions and project-relative inputs. Keep it consistent across session calls. |
| --json | Emit one versioned JSON envelope on stdout. Progress goes to stderr. |
| --input <file> | Read a JSON object with camelCase command-specific keys. - reads stdin. The file is resolved from cwd. |
| --deadline <ms> | Positive integer millisecond budget for the whole command; owned cleanup may take longer. |
| --session <id> | Reuse a project-local connection worker for supported commands. Falls back to FLIWRIGHT_SESSION. |
| --help | Show generated command usage without execution. |

Positional fields such as script file, scenario name and flow id can instead be supplied in the input JSON. They are not flags. Unknown fields and duplicate fields supplied through both CLI and JSON are rejected. Common options belong on the CLI, not inside --input JSON. Boolean flags accept an omitted value (true), true or false; do not invent --no-* flags. Array flags can be repeated or accept a JSON array. Prefer --input for nested objects and arrays of objects. Do not pass a CLI envelope as input: extract the command’s data and construct its expected input object.

--cwd does not uniformly rebase every explicit path: some Flow output/input paths are passed directly to filesystem APIs. When executing from outside the project, use absolute explicit paths as well as --cwd. source and snapshot generation fields contain content, not paths. All time budgets are milliseconds except record --duration, which is seconds.

Discover the installed surface with fliwright schema --json. Inspect a command with fliwright schema app.interact --json. The input schema is strict. The output schema covers the outer envelope, with an open command-specific data value; it is not a complete result type validator. The documentation describes useful result fields, not an exhaustive machine result schema.

## JSON result

\`\`\`json
{"schemaVersion":1,"command":"app.snapshot","requestId":"REQUEST_ID","operationId":"OPERATION_ID","ok":true,"data":{"snapshot":"...","refs":[]}}
\`\`\`

operationId exists for commands routed through a connection worker, and is the recovery key. Failure has ok:false and error:{code,message,retryable:false}; data may still contain important evidence. Some successful commands return no data. Check process exit code and ok, then command-specific readiness/partial/status fields. For example, doctor without strict, a draft recording, partial debug capture, or a blocked DevAssist result can complete without demonstrating the intended business success.

## Exit codes and recovery

| Code | Meaning | Next action |
| --- | --- | --- |
| 0 | Command completed | Inspect command-specific status, readiness and completeness. |
| 1 | Test, spec validation or review failed | Keep data/artifacts; inspect failures, missing targets or invalid spec issues. |
| 2 | Invalid input | Inspect schema and conditional requirements; correct input before rerunning. |
| 3 | Execution/environment unavailable | Inspect error and retained evidence; check doctor, endpoint and provider availability. |
| 4 | Workflow conflict | Check session/runtime state, version and endpoint ownership. |
| 5 | Deadline exceeded | Query operation status and inspect artifacts; increase budget only after understanding the outcome. |
| 130 | Cancelled | Inspect final operation state and evidence before retrying. |

SIGINT/SIGTERM request cancellation. Recording’s first SIGINT is a graceful stop/flush; a second interrupts finalization. A session cancellation acknowledgement is not final completion. After a lost response, use session status --session "$SESSION_ID" --operation-id <operationId> --json. Do not replay an uncertain app mutation automatically. The worker’s queue prevents concurrent mutation while owned work settles.

## Connection and TDD lifecycle

\`\`\`sh
fliwright session open --vm-url "$VM_URL" --json
# Set SESSION_ID to data.sessionId from the result.
fliwright app snapshot --session "$SESSION_ID" --json
fliwright tdd start --session "$SESSION_ID" --json
fliwright tdd focus --file .fliwright/tests/counter.test.ts --session "$SESSION_ID" --json
fliwright tdd cycle --sync reload --session "$SESSION_ID" --json
fliwright tdd stop --keep-app-alive true --session "$SESSION_ID" --json
fliwright session close --session "$SESSION_ID" --json
\`\`\`

A managed session open --device-id DEVICE_ID starts its TDD runtime automatically: skip tdd start. Attach sessions require tdd start for persistent focus/cycle. Sessions are local retained connections, not canonical run identities. run/script/record use finite drivers and do not route through --session. Offline schema, local catalogs and artifact queries do not need a session. A session-routed command cannot replace the worker’s vmUrl/deviceId. Use session close when finished.

Use named composed TestScenario declarations for repeatable environments. Authenticated business tests seed app-owned auth state through auth.seedLoggedIn. run --scenario applies setup before every attempt/retry; manually applying a baseline is useful for exploration but does not replace fixture setup. Strict startup isolation requires managed launch plus app-side waiting bootstrap.

## CI evidence

\`\`\`sh
fliwright run --vm-url "$VM_URL" --scenario logged-in --json \\
  --junit-output artifacts/junit.xml --runs-root artifacts/runs \\
  --output artifacts/report.json --deadline 180000
\`\`\`

Run root precedence is explicit --runs-root, FLIWRIGHT_RUNS_ROOT, project config, then <project>/.fliwright/runs. Relative roots resolve from the project config directory. Configure cacheRoot independently (default <project>/.fliwright/cache). Offline queries use the same resolved run directory. The CI example uses an explicit root for portable upload.

The named scenario and test selectors must exist in the target project. Use --device-id with a bridge-enabled target instead of --vm-url for an owned launch. Preserve the runner exit code. Upload artifacts/runs, report.json and junit.xml in an always-run CI step, including failed/cancelled runs; artifact finalization can itself fail, so retain any paths supplied in data. --output is JSON, --junit-output is XML. Investigate offline with artifacts show/failures/timeline using the same --runs-root; select testId and attemptId when multiple attempts exist.
`;
export async function buildCommandReferences(registry, validateExample) {
  const definitions = [...registry.definitions.values()];
  const names = new Set(definitions.map((definition) => definition.path));
  const extra = Object.keys(commandDocs).filter((path) => !names.has(path));
  if (extra.length) throw new Error(`Stale command guides: ${extra.join(', ')}`);
  for (const definition of definitions) if (!commandDocs[definition.path]) throw new Error(`Missing command guide: ${definition.path}`);
  let examples = 0;
  const pages = new Map([['index.md', renderIndex(registry)], ['common.md', commonGuide]]);
  for (const definition of definitions) {
    const guide = commandDocs[definition.path];
    if (!guide?.summary || !guide.use || !Object.keys(guide.result).length || !guide.notes.length || !guide.examples.length) throw new Error(`Incomplete guide: ${definition.path}`);
    if (!groups[commandGroup(definition.path)]) throw new Error(`Missing routing group: ${definition.path}`);
    for (const related of guide.related) if (!names.has(related)) throw new Error(`Broken related command: ${definition.path} → ${related}`);
    for (const example of guide.examples) {
      definition.input.strict().parse(example.input);
      await validateExample?.(definition, example);
      examples++;
    }
    pages.set(commandFile(definition.path), renderCommand(registry, definition));
  }
  // Verify portable reference links, including workflow links not derived from metadata.
  for (const [name, content] of pages) for (const match of content.matchAll(/\]\(\.\/([^#)]+)(?:#[^)]+)?\)/g)) {
    if (!pages.has(match[1])) throw new Error(`Broken reference in ${name}: ${match[1]}`);
  }
  return { pages, commands: definitions.length, examples };
}
