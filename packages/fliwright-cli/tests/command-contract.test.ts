import { expect, it } from 'vitest';
import { RunFinalizationError } from '../src/commands/run.js';
import { CommandRegistry } from '../src/CommandRegistry.js';
import { createProgram, executeCli } from '../src/index.js';

it('discovers commands from the same registry used for execution', async () => {
  const result = await executeCli(['schema', 'app.interact', '--json']);
  expect(result.exitCode).toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(envelope).toMatchObject({ schemaVersion: 1, command: 'schema', ok: true });
  expect(envelope.data.input.properties.operation.enum).toContain('tap');
  expect(envelope.data).toMatchObject({ needsApp: true, exitCodes: { '2': 'INVALID_INPUT', '5': 'DEADLINE_EXCEEDED' }, output: { type: 'object', required: expect.arrayContaining(['schemaVersion', 'requestId', 'ok']) } });
});

it('returns one JSON error and usage exit before touching an app for invalid operations', async () => {
  const result = await executeCli(['app', 'interact', 'typo', '--json']);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('returns Commander parse failures in the machine contract', async () => {
  const result = await executeCli(['app', 'observe', '--unknown', '--json']);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('does not advertise the removed MCP protocol or deprecated aliases', () => {
  const names = createProgram().commands.map((command) => command.name());
  expect(names).not.toContain('mcp');
  expect(names).not.toContain('mock:start');
});


it('preserves the business result and artifact identity when finalization fails', async () => {
  const registry = new CommandRegistry();
  const { z } = await import('zod');
  registry.add({ path: 'probe', description: 'probe', effects: [], input: z.object({}), execute() {
    throw new RunFinalizationError({ passed: false, results: [] } as never, { runId: 'run-failed', outputDir: '/evidence' }, new Error('disk full'));
  } });
  const result = await executeCli(['probe', '--json'], registry);
  expect(result.exitCode).toBe(3);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'ARTIFACT_FINALIZATION_FAILED' }, data: { runId: 'run-failed', outputDir: '/evidence', runnerResult: { passed: false } } });
});


it('treats the first recording interrupt as stop and a second interrupt as cancellation', async () => {
  for (const twice of [false, true]) {
    const { z } = await import('zod');
    const registry = new CommandRegistry();
    let ready!: () => void;
    const waiting = new Promise<void>((resolve) => { ready = resolve; });
    let flush!: () => void;
    const flushed = new Promise<void>((resolve) => { flush = resolve; });
    registry.add({ path: 'record', description: 'record', input: z.object({}), effects: [], async execute(_input, context) {
      ready();
      await context.waitForInterrupt!(new AbortController().signal);
      await flushed;
      return { stopped: true };
    } });
    const pending = executeCli(['record', '--json'], registry);
    await waiting;
    process.emit('SIGINT');
    if (twice) process.emit('SIGINT');
    flush();
    const result = await pending;
    expect(result.exitCode).toBe(twice ? 130 : 0);
    expect(JSON.parse(result.stdout)).toHaveProperty('data.stopped', true);
  }
});
