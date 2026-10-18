import { Command, CommanderError } from 'commander';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode = 3, readonly data?: unknown) { super(message); }
}
export interface CommandContext { cwd: string; signal: AbortSignal; requestId: string; session?: string; waitForInterrupt?: (signal: AbortSignal) => Promise<void>; }
export interface CommandDefinition {
  path: string;
  description: string;
  input: z.AnyZodObject;
  effects: string[];
  needsApp?: boolean;
  needsSession?: boolean;
  output?: string;
  positional?: string[];
  aliases?: Record<string, string>;
  execute(input: any, context: CommandContext): Promise<unknown> | unknown;
}
export interface CliExecution { stdout: string; stderr: string; exitCode: number; }
export class CommandRegistry {
  readonly definitions = new Map<string, CommandDefinition>();
  add(definition: CommandDefinition): void {
    if (this.definitions.has(definition.path)) throw new Error(`Duplicate command ${definition.path}`);
    this.definitions.set(definition.path, definition);
  }
  schema(path?: string): unknown {
    if (!path) return { commands: [...this.definitions.values()].map(({ path, description, effects, needsApp, needsSession }) => ({ path, description, effects, needsApp: Boolean(needsApp), needsSession: Boolean(needsSession) })) };
    const definition = this.definitions.get(path.replace(/ /g, '.'));
    if (!definition) throw new CliError('INVALID_INPUT', `Unknown command: ${path}`, 2);
    return { command: definition.path, description: definition.description,
      input: zodToJsonSchema(definition.input.strict(), { $refStrategy: 'none' }),
      outputType: definition.output ?? 'CommandResult.data',
      output: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', additionalProperties: false,
        required: ['schemaVersion', 'command', 'requestId', 'ok'], properties: {
          schemaVersion: { const: 1 }, command: { const: definition.path }, requestId: { type: 'string' },
          operationId: { type: 'string' }, ok: { type: 'boolean' }, data: { description: definition.output ?? 'Command-specific result or partial failure evidence' },
          error: { type: 'object', required: ['code', 'message', 'retryable'], additionalProperties: false,
            properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { const: false } } },
        }, allOf: [{ if: { properties: { ok: { const: false } } }, then: { required: ['error'] } }],
      },
      exitCodes: { 0: 'SUCCESS', 1: 'TEST_OR_REVIEW_FAILED', 2: 'INVALID_INPUT', 3: 'EXECUTION_UNAVAILABLE', 4: 'WORKFLOW_CONFLICT', 5: 'DEADLINE_EXCEEDED', 130: 'CANCELLED' },
      cancellation: { deadlineUnit: 'milliseconds', signals: ['SIGINT', 'SIGTERM'], session: 'Query operation status before retrying uncertain mutations.' }, effects: definition.effects,
      needsApp: Boolean(definition.needsApp), needsSession: Boolean(definition.needsSession),
      common: { cwd: 'Project root', json: 'One versioned result on stdout', input: 'JSON file or stdin; duplicate fields are rejected', deadline: 'Milliseconds; cancellation waits for owned work to settle', session: 'Explicit CLI connection session' } };
  }
  program(onExecute: (definition: CommandDefinition, input: any, options: Record<string, unknown>) => Promise<void>): Command {
    const root = new Command().name('fliwright').description('Flutter automation for terminals, coding agents and CI').version('0.1.0');
    const groups = new Map<string, Command>([['', root]]);
    for (const definition of this.definitions.values()) {
      const parts = definition.path.split('.');
      let parent = root;
      let groupPath = '';
      for (const part of parts.slice(0, -1)) {
        groupPath = groupPath ? `${groupPath}.${part}` : part;
        let group = groups.get(groupPath);
        if (!group) { group = parent.command(part); groups.set(groupPath, group); }
        parent = group;
      }
      const command = parent.command(parts.at(-1)!).description(definition.description);
      command.exitOverride();
      for (const field of definition.positional ?? []) command.argument(`[${field}]`);
      for (const [key, field] of Object.entries(definition.input.shape) as Array<[string, z.ZodTypeAny]>) {
        if (definition.positional?.includes(key)) continue;
        const shape = unwrap(field);
        const flag = definition.aliases?.[key] ?? key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        const description = field.description ?? key;
        if (shape instanceof z.ZodBoolean) command.option(`--${flag} [boolean]`, description, parseBoolean);
        else if (shape instanceof z.ZodArray) command.option(`--${flag} <value>`, description, (value: string, previous: unknown[] = []) => {
          if (value.trim().startsWith('[')) {
            try { const values = JSON.parse(value); if (Array.isArray(values)) return [...previous, ...values]; } catch {}
            throw new CliError('INVALID_INPUT', 'Expected JSON array.', 2);
          }
          return [...previous, parseValue(value, shape.element)];
        });
        else command.option(`--${flag} <value>`, description, (value: string) => parseValue(value, shape));
      }
      command.option('--cwd <directory>', 'Project root').option('--json', 'Print one versioned JSON result')
        .option('--input <file>', 'Structured JSON input; - reads stdin')
        .option('--deadline <ms>', 'Command deadline in milliseconds')
        .option('--session <id>', 'Explicit connection session');
      command.action(async (...args: any[]) => {
        const options = args.at(-2) as Record<string, unknown>;
        const input: Record<string, unknown> = {};
        for (const key of Object.keys(definition.input.shape)) if (options[key] !== undefined) input[key] = options[key];
        for (const [i, key] of (definition.positional ?? []).entries()) if (args[i] !== undefined) input[key] = args[i];
        if (options.input) {
          const body = options.input === '-' ? await readStdin() : await readFile(resolve(String(options.cwd ?? process.cwd()), String(options.input)), 'utf8');
          let parsed: unknown;
          try { parsed = JSON.parse(body); } catch { throw new CliError('INVALID_INPUT', 'Input must be valid JSON.', 2); }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CliError('INVALID_INPUT', 'Input must be a JSON object.', 2);
          for (const [key, value] of Object.entries(parsed)) {
            if (key in input) throw new CliError('INVALID_INPUT', `Duplicate input field: ${key}`, 2);
            input[key] = value;
          }
        }
        await onExecute(definition, definition.input.strict().parse(input), options);
      });
    }
    root.exitOverride();
    return root;
  }
}
function unwrap(field: z.ZodTypeAny): z.ZodTypeAny {
  if (field instanceof z.ZodOptional || field instanceof z.ZodNullable) return unwrap(field.unwrap());
  if (field instanceof z.ZodDefault) return unwrap(field.removeDefault());
  if (field instanceof z.ZodEffects) return unwrap(field.innerType());
  return field;
}
function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === 'true') return true;
  if (value === 'false') return false;
  throw new CliError('INVALID_INPUT', 'Expected true or false.', 2);
}
function parseValue(value: string, field: z.ZodTypeAny): unknown {
  if (field instanceof z.ZodNumber) return Number(value);
  if (field instanceof z.ZodObject || field instanceof z.ZodRecord) {
    try { return JSON.parse(value); } catch { throw new CliError('INVALID_INPUT', 'Expected JSON value.', 2); }
  }
  return value;
}
async function readStdin(): Promise<string> {
  let body = '';
  for await (const chunk of process.stdin) body += String(chunk);
  return body;
}
export function classifyError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof Error && error.name === 'RunFinalizationError' && 'runnerResult' in error && 'runId' in error && 'outputDir' in error) {
    return new CliError('ARTIFACT_FINALIZATION_FAILED', error.message, 3, { runnerResult: error.runnerResult, runId: error.runId, outputDir: error.outputDir });
  }
  if (error instanceof z.ZodError || error instanceof CommanderError) return new CliError('INVALID_INPUT', error.message, 2);
  if (error instanceof Error && error.name === 'TimeoutError') return new CliError('DEADLINE_EXCEEDED', error.message, 5);
  if (error instanceof Error && error.name === 'AbortError') return new CliError('CANCELLED', error.message, 130);
  return new CliError('EXECUTION_UNAVAILABLE', error instanceof Error ? error.message : String(error), 3);
}
export function requestId(): string { return randomUUID(); }
