#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { formatJunit, formatPretty, type CliRunResult } from './reporter.js';
import { CommandRegistry, CliError, classifyError, requestId } from './CommandRegistry.js';
import { registerSessions } from './registry/session.js';
import { sessionRequest } from './session/client.js';
import { registerTdd } from './registry/tdd.js';
import { registerFlow } from './registry/flow.js';
import { registerFinite } from './registry/finite.js';

export function createRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  registerFinite(registry);
  registerFlow(registry);
  registerTdd(registry);
  registerSessions(registry);
  return registry;
}
export function createProgram() { return createRegistry().program(async (definition, input, common) => {
  await definition.execute(input, { cwd: resolve(String(common.cwd ?? process.cwd())), requestId: requestId(), signal: new AbortController().signal });
}); }

/** Execute the same registry used by --help/schema without exiting the embedding process. */
export async function executeCli(argv: string[], registry = createRegistry()): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  let command = argv.filter((entry) => !entry.startsWith('-')).slice(0, 2).join('.');
  let data: unknown;
  let sessionOperation = false;
  const id = requestId();
  const json = argv.includes('--json');
  const controller = new AbortController();
  let gracefulInterrupt: (() => void) | undefined;
  const interrupt = () => {
    if (gracefulInterrupt) { const stop = gracefulInterrupt; gracefulInterrupt = undefined; stop(); }
    else controller.abort(new DOMException('Command cancelled.', 'AbortError'));
  };
  const waitForInterrupt = (signal: AbortSignal) => new Promise<void>((resolveStop) => {
    const cleanup = () => { if (gracefulInterrupt === stop) gracefulInterrupt = undefined; signal.removeEventListener('abort', stop); };
    const stop = () => { cleanup(); resolveStop(); };
    if (signal.aborted) { resolveStop(); return; }
    gracefulInterrupt = stop;
    signal.addEventListener('abort', stop, { once: true });
  });
  const terminate = () => controller.abort(new DOMException('Command terminated.', 'AbortError'));
  let deadlineTimer: NodeJS.Timeout | undefined;
  let failure: CliError | undefined;
  let selectedReporter: string | undefined;
  const program = registry.program(async (definition, input, common) => {
    command = definition.path;
    const cwd = resolve(String(common.cwd ?? process.cwd()));
    if (common.deadline !== undefined) {
      const deadline = Number(common.deadline);
      if (!Number.isSafeInteger(deadline) || deadline <= 0) throw new CliError('INVALID_INPUT', 'deadline must be a positive integer in milliseconds.', 2);
      deadlineTimer = setTimeout(() => controller.abort(new DOMException('Command deadline exceeded.', 'TimeoutError')), deadline);
    }
    if (json && input.reporter && input.reporter !== 'json') throw new CliError('INVALID_INPUT', '--json conflicts with an explicit non-JSON reporter.', 2);
    selectedReporter = input.reporter;
    const session = common.session as string | undefined ?? process.env.FLIWRIGHT_SESSION;
    const routedToSession = Boolean(session && (definition.needsSession || (definition.needsApp && !['run', 'script', 'record'].includes(definition.path)) || ['generate-test', 'tdd.cycle', 'tdd.sync', 'tdd.status'].includes(definition.path)));
    if (routedToSession && (input.vmUrl || input.deviceId)) throw new CliError('INVALID_INPUT', '--session cannot change its endpoint or device.', 2);
    if (routedToSession && session) {
      sessionOperation = true;
      const onAbort = () => { void sessionRequest(cwd, session, { type: 'cancel', operationId: id }, AbortSignal.timeout(2000)).catch(() => {}); };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      try { data = await sessionRequest(cwd, session, { type: 'execute', operationId: id, command: definition.path, input }, controller.signal); }
      finally { controller.signal.removeEventListener('abort', onAbort); }
    } else data = await definition.execute(input, { cwd, signal: controller.signal, requestId: id, session, waitForInterrupt });
    controller.signal.throwIfAborted();
  });
  program.configureOutput({ writeOut: (message) => { stdout += message; }, writeErr: (message) => { stderr += message; } });
  process.on('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try { await program.parseAsync(argv, { from: 'user' }); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['commander.helpDisplayed', 'commander.version'].includes(String(error.code))) {
      return { stdout, stderr, exitCode: 0 };
    }
    failure = classifyError(controller.signal.aborted ? controller.signal.reason : error);
    if (failure.data !== undefined) data = failure.data;
    exitCode = failure.exitCode;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
  if (json) {
    stdout = JSON.stringify({ schemaVersion: 1, command, requestId: id, ...(sessionOperation ? { operationId: id } : {}), ok: !failure,
      ...(data !== undefined ? { data } : {}),
      ...(failure ? { error: { code: failure.code, message: failure.message, retryable: false } } : {}),
    }) + '\n';
    // Commander usage errors belong to the envelope; progress stays on stderr.
    if (failure?.code === 'INVALID_INPUT') stderr = '';
  } else if (data !== undefined) {
    stdout += (['run', 'script'].includes(command) && selectedReporter === 'junit' ? formatJunit(data as CliRunResult)
      : ['run', 'script'].includes(command) && !selectedReporter ? formatPretty(data as CliRunResult)
      : JSON.stringify(data, null, 2)) + '\n';
  }
  if (failure && !json) stderr += `${failure.code}: ${failure.message}\n`;
  return { stdout, stderr, exitCode };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  executeCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  }).catch((error) => { console.error(error); process.exitCode = 3; });
}
