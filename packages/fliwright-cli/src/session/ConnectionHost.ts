import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TddRuntime } from '@fliwright/tdd';
import { CommandRegistry, CliError, type CommandContext } from '../CommandRegistry.js';
import { registerFinite } from '../registry/finite.js';
import { registerFlow } from '../registry/flow.js';
import { connectAppSession, type AppSession, type AppSessionDeps } from '../capabilities/session.js';
import type { TddWorkflowContext } from '../WorkflowContext.js';

/** Owns persistent objects only; run evidence, artifacts and endpoint leases keep their existing owners. */
export class ConnectionHost {
  private session?: AppSession;
  private runtime?: TddRuntime;
  private workflow?: TddWorkflowContext;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closing = false;
  constructor(private readonly options: AppSessionDeps & { cwd: string; vmUrl?: string; id?: string; runtimeFactory?: () => TddRuntime }) {}
  async open(signal?: AbortSignal): Promise<{ connected: true }> {
    if (this.closed) throw new CliError('SESSION_CLOSED', 'Session is closed.', 4);
    if (!this.session) this.session = await connectAppSession({ ...this.options, signal }, this.options);
    return { connected: true };
  }
  async whenIdle(): Promise<void> { await this.queue; }
  async refreshEndpoint(): Promise<void> {
    const endpoint = this.runtime?.endpoint ?? this.options.vmUrl;
    await this.session?.driver.dispose(); this.session = undefined;
    this.session = await connectAppSession({ cwd: this.options.cwd, vmUrl: endpoint }, this.options);
  }
  async reconnectRuntime(): Promise<unknown> {
    const result = await this.getRuntime().reconnect();
    await this.refreshEndpoint();
    return result;
  }
  async reconnect(): Promise<void> {
    await this.queue;
    await this.refreshEndpoint();
  }
  status() { return { connected: Boolean(this.session), endpoint: this.session?.vmServiceUrl, tdd: this.runtime?.snapshot(), workflow: this.workflow, closed: this.closed }; }
  getRuntime(): TddRuntime {
    if (!this.runtime) throw new CliError('TDD_NOT_STARTED', 'Start the TDD runtime before this command.', 4);
    return this.runtime;
  }
  async startRuntime(input: Parameters<TddRuntime['start']>[0]) {
    if (this.runtime) throw new CliError('TDD_ALREADY_STARTED', 'Stop the current runtime before starting another.', 4);
    const runtime = this.options.runtimeFactory?.() ?? new TddRuntime();
    this.runtime = runtime;
    let result;
    try { result = await runtime.start(input); }
    catch (error) { this.runtime = undefined; throw error; }
    if (runtime.endpoint && this.session?.vmServiceUrl !== runtime.endpoint) {
      await this.session?.driver.dispose();
      this.session = await connectAppSession({ cwd: this.options.cwd, vmUrl: runtime.endpoint }, this.options);
    }
    return result;
  }
  async stopRuntime(keepAppAlive = false) {
    const runtime = this.getRuntime();
    await runtime.stop({ keepAppAlive });
    this.runtime = undefined;
    return runtime.snapshot();
  }
  setWorkflow(context: TddWorkflowContext) {
    this.workflow = context;
    const directory = join(this.options.cwd, '.fliwright', 'sessions', this.options.id ?? 'local');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, 'workflow.json'), JSON.stringify(context), { mode: 0o600 });
  }
  getWorkflow() { return this.workflow; }
  async execute(command: string, input: unknown, context?: Partial<CommandContext> & { onStart?: () => Promise<void> }): Promise<unknown> {
    if (this.closing || this.closed) throw new CliError('SESSION_CLOSED', 'Session is closing.', 4);
    const abort = () => { if (command.startsWith('tdd.') || command.startsWith('devassist.')) void this.runtime?.cancel(); };
    const run = this.queue.then(async () => {
      context?.signal?.throwIfAborted();
      context?.signal?.addEventListener('abort', abort, { once: true });
      await context?.onStart?.();
      if (this.closed) throw new CliError('SESSION_CLOSED', 'Session is closed.', 4);
      const registry = new CommandRegistry();
      registerFinite(registry, { app: { sessionProvider: async () => { await this.open(); return this.session!; } } });
      registerFlow(registry, { sessionProvider: async () => { await this.open(); return this.session!; } });
      const { registerTdd } = await import('../registry/tdd.js');
      registerTdd(registry, this);
      const definition = registry.definitions.get(command);
      if (!definition || command === 'mock.start' || (!command.startsWith('tdd.') && !command.startsWith('devassist.') && !command.startsWith('app.') && !command.startsWith('scenario.') && !command.startsWith('mock.') && !command.startsWith('flow.review-') && command !== 'generate-test')) throw new CliError('INVALID_INPUT', `Command cannot execute in a connection session: ${command}`, 2);
      const parsed = definition.input.strict().parse(input);
      const result = await definition.execute(parsed, { cwd: this.options.cwd, requestId: context?.requestId ?? 'local', signal: context?.signal ?? new AbortController().signal });
      context?.signal?.throwIfAborted();
      return result;
    });
    // Runtime cycle timeouts can return before the executor settles; retain host ownership until idle.
    this.queue = run.catch(() => {}).then(async () => {
      await this.runtime?.whenIdle();
      context?.signal?.removeEventListener('abort', abort);
      if (context?.signal?.aborted && this.session) { await this.session.driver.dispose({ signal: AbortSignal.abort() }); this.session = undefined; }
    });
    return run;
  }
  async close(keepAppAlive = false): Promise<void> {
    this.closing = true;
    await this.queue;
    this.closed = true;
    try { if (this.runtime) await this.stopRuntime(keepAppAlive); }
    finally { await this.session?.driver.dispose(); this.session = undefined; }
  }
}
