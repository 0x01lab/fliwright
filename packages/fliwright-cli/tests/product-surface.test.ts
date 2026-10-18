import { describe, expect, it } from 'vitest';
import { createProgram } from '../src/index.js';

describe('CLI-first product surface', () => {
  it('exposes stable intent command groups', () => {
    const program = createProgram();

    expect(subcommands(program, 'app')).toEqual(['debug-snapshot', 'diagnostics', 'find', 'interact', 'observe', 'reload', 'screenshot', 'snapshot', 'source-map', 'status']);
    expect(subcommands(program, 'scenario')).toEqual(['apply', 'list', 'reset', 'resolve']);
    expect(subcommands(program, 'mock')).toEqual(['apply', 'calls', 'clear-calls', 'list', 'reset', 'start', 'status']);
    expect(subcommands(program, 'artifacts')).toEqual(['diagnose', 'export', 'failures', 'show', 'timeline']);
    expect(subcommands(program, 'session')).toEqual(['cancel', 'close', 'list', 'open', 'reconnect', 'status']);
  });

  it('removes the deprecated mock:start alias', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).not.toContain('mock:start');
  });

  it('does not invent explicit run overrides for absent flags', () => {
    const run = createProgram().commands.find((command) => command.name() === 'run')!;
    for (const field of ['reporter', 'timeout', 'screenshot', 'recordingMode']) {
      const option = run.options.find((candidate) => candidate.attributeName() === field)!;
      expect(option.defaultValue, field).toBeUndefined();
    }
  });
});

function subcommands(program: ReturnType<typeof createProgram>, name: string): string[] {
  const command = program.commands.find((candidate) => candidate.name() === name);
  expect(command, `missing command group ${name}`).toBeDefined();
  return command!.commands.map((candidate) => candidate.name()).sort();
}
