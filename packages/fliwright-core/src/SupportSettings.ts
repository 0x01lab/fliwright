import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { EndpointLeaseManager } from './EndpointLease.js';
import { resolveFliwrightProjectRoot, resolveFliwrightRuntimeRoot } from './runArtifacts.js';

const fields = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().optional(),
  env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
});
const length = z.number().int().nonnegative().optional();
const number = z.number().finite();
const fieldSchema = z.discriminatedUnion('type', [
  fields.extend({ type: z.literal('string'), default: z.string().optional(), minLength: length, maxLength: length }).strict(),
  fields.extend({ type: z.literal('number'), default: number.optional(), min: number.optional(), max: number.optional(), integer: z.boolean().optional() }).strict(),
  fields.extend({ type: z.literal('boolean'), default: z.boolean().optional() }).strict(),
  fields.extend({
    type: z.literal('select'), default: z.string().optional(),
    options: z.array(z.object({ value: z.string(), label: z.string().min(1) }).strict()).min(1).readonly(),
  }).strict(),
]);
const supportId = z.string().max(96).regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
  'Use lowercase ASCII letters and numbers, optionally separated by dots, underscores or hyphens.')
  .refine(id => !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/.test(id), 'Use a non-reserved file name.');
const definitionSchema = z.object({
  id: supportId,
  title: z.string().min(1),
  fields: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]*$/), fieldSchema),
}).strict().superRefine((definition, context) => {
  for (const [key, field] of Object.entries(definition.fields)) {
    const issue = (property: string, message: string) => context.addIssue({
      code: z.ZodIssueCode.custom, path: ['fields', key, property], message,
    });
    if (field.type === 'string' && field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) {
      issue('maxLength', 'Use a maximum length greater than or equal to the minimum.');
    }
    if (field.type === 'number' && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      issue('max', 'Use a maximum greater than or equal to the minimum.');
    }
    if (field.type === 'select' && new Set(field.options.map(option => option.value)).size !== field.options.length) {
      issue('options', 'Use unique option values.');
    }
    if (field.default !== undefined) {
      const message = invalidValue(field, field.default);
      if (message) issue('default', message);
    }
  }
});

export const supportSettingsRegistrySchema = z.array(definitionSchema).readonly().superRefine((definitions, context) => {
  const seen = new Set<string>();
  for (const [index, { id }] of definitions.entries()) {
    if (seen.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'id'], message: `Duplicate support ID "${id}".` });
    seen.add(id);
  }
});

export type SupportSettingField = z.infer<typeof fieldSchema>;
export type SupportSettingsDefinition = z.infer<typeof definitionSchema>;
export type SupportSettingValue = string | number | boolean;

type FieldValue<Field> = Field extends { type: 'select'; options: readonly { value: infer Value }[] } ? Value
  : Field extends { type: 'number' } ? number
    : Field extends { type: 'boolean' } ? boolean : string;

export type SupportSettingsValues<Definition extends SupportSettingsDefinition> = {
  -readonly [Key in keyof Definition['fields']]: FieldValue<Definition['fields'][Key]>
    | (Definition['fields'][Key] extends { required: true } | { default: SupportSettingValue } ? never : undefined);
};

export interface SupportSettingsProjectOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export interface SupportSettingsSnapshot {
  /** Changes whenever the file changes. Use this revision when saving an edit. */
  revision: string | null;
  file: string;
  values: Record<string, SupportSettingValue>;
  issues: Record<string, string>;
}

export class SupportSettingsError extends Error {
  constructor(public readonly code: 'invalid-field' | 'missing-field' | 'storage' | 'conflict', message: string, public readonly field?: string) {
    super(message);
    this.name = 'SupportSettingsError';
  }
}

/** A required value was absent from every configured source. */
export class MissingSupportSettingError extends SupportSettingsError {
  declare readonly field: string;

  constructor(public readonly supportId: string, field: string, public readonly file: string, public readonly env?: string) {
    super('missing-field', `Missing required support setting "${field}" for support "${supportId}". Local settings file ${file}.${env ? ` Environment variable ${env}.` : ''}`, field);
    this.name = 'MissingSupportSettingError';
  }
}

/** Recognize the diagnostic in an error or in a text-only test report or process stack. */
export function missingSupportSettingMessage(error: unknown): string | undefined {
  const text = error instanceof Error ? error.message : error;
  if (typeof text !== 'string') return undefined;
  return /^(?:MissingSupportSettingError: )?(Missing required support setting "[A-Za-z][A-Za-z0-9_.-]*" for support "[a-z0-9._-]+"\.[^\r\n]*)/m.exec(text)?.[1];
}

/** Declare serializable settings without accessing a device or loading local values. */
export function defineSupportSettings<const Definition extends SupportSettingsDefinition>(definition: Definition): Definition {
  definitionSchema.parse(definition);
  return definition;
}

const storedSettings = z.object({
  version: z.literal(1),
  values: z.record(z.union([z.string(), number, z.boolean()])),
}).strict();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function settingsFile(id: string, options: SupportSettingsProjectOptions): Promise<string> {
  supportId.parse(id);
  const env = options.env ?? process.env;
  const start = options.projectRoot ?? (env.FLIWRIGHT_PROJECT_ROOT || process.cwd());
  const projectRoot = await realpath(resolveFliwrightProjectRoot(await realpath(resolve(start))));
  const root = resolveFliwrightRuntimeRoot({ projectRoot, env, homeDir: options.homeDir });
  return join(root, 'support-settings', digest(projectRoot), `${id}.json`);
}

async function readStored(file: string): Promise<Pick<SupportSettingsSnapshot, 'revision' | 'values'>> {
  let contents: string;
  try {
    contents = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: null, values: {} };
    throw new SupportSettingsError('storage', `Could not read support settings at ${file}.`);
  }
  try {
    return { revision: digest(contents), values: storedSettings.parse(JSON.parse(contents)).values };
  } catch {
    throw new SupportSettingsError('storage', `Support settings at ${file} contain invalid JSON or an unsupported format.`);
  }
}

function snapshot(definition: SupportSettingsDefinition, file: string, stored: Awaited<ReturnType<typeof readStored>>): SupportSettingsSnapshot {
  const current = Object.entries(definition.fields).filter(([key]) => Object.hasOwn(stored.values, key));
  const values = Object.fromEntries(current.map(([key]) => [key, stored.values[key]]));
  const issues = Object.fromEntries(current.flatMap(([key, field]) => {
    const issue = invalidValue(field, values[key]);
    return issue ? [[key, issue]] : [];
  }));
  return { file, revision: stored.revision, values, issues };
}

/** Load only locally saved values and field issues for an editor. */
export async function loadSupportSettings(definition: SupportSettingsDefinition, options: SupportSettingsProjectOptions = {}): Promise<SupportSettingsSnapshot> {
  const file = await settingsFile(definition.id, options);
  return snapshot(definition, file, await readStored(file));
}

/** Apply explicit edits to the latest file if its revision still matches. Null clears a local value. */
export async function saveSupportSettings(
  definition: SupportSettingsDefinition,
  edit: { revision: string | null; changes: Readonly<Record<string, SupportSettingValue | null>> },
  options: SupportSettingsProjectOptions = {},
): Promise<SupportSettingsSnapshot> {
  const changes = Object.entries(edit.changes);
  for (const [key, value] of changes) {
    if (!Object.hasOwn(definition.fields, key)) {
      throw new SupportSettingsError('invalid-field', `Unknown field "${key}" in support "${definition.id}".`, key);
    }
    if (value !== null) assertValue(definition, key, value, 'local value');
  }
  const file = await settingsFile(definition.id, options);
  const directory = dirname(file);
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // The cross-process lease keeps the revision check and atomic replacement in one transaction.
  const lease = await new EndpointLeaseManager({ rootDir: directory }).acquire(pathToFileURL(file).href, {
    signal: AbortSignal.timeout(5000),
  });
  try {
    const stored = await readStored(file);
    if (stored.revision !== edit.revision) {
      throw new SupportSettingsError('conflict', 'Support settings changed in another window. Reload before saving.');
    }
    const values = stored.values;
    for (const [key, value] of changes) {
      if (value === null) delete values[key];
      else values[key] = value;
    }
    const contents = `${JSON.stringify({ version: 1, values }, null, 2)}\n`;
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    return snapshot(definition, file, { revision: digest(contents), values });
  } finally {
    await lease.release();
  }
}

/** Resolve typed values at the point of use, reading local settings when needed. */
export async function readSupportSettings<const Definition extends SupportSettingsDefinition>(
  definition: Definition,
  options: SupportSettingsProjectOptions & { overrides?: Partial<SupportSettingsValues<Definition>> } = {},
): Promise<SupportSettingsValues<Definition>> {
  const env = options.env ?? process.env;
  const overrides: Record<string, unknown> = options.overrides ?? {};
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(definition.fields, key)) {
      throw new SupportSettingsError('invalid-field', `Unknown override "${key}" in support "${definition.id}".`, key);
    }
  }
  let stored: Awaited<ReturnType<typeof readStored>> | undefined;
  let file: string | undefined;
  const result: Array<[string, SupportSettingValue | undefined]> = [];
  for (const [key, field] of Object.entries(definition.fields)) {
    const override = Object.hasOwn(overrides, key) ? overrides[key] : undefined;
    const fromEnv = field.env && Object.hasOwn(env, field.env) ? env[field.env] : undefined;
    if (override !== undefined) {
      result.push([key, assertValue(definition, key, override, 'explicit override')]);
    } else if (fromEnv !== undefined) {
      result.push([key, assertValue(definition, key, parseEnv(field, fromEnv), `environment variable ${field.env}`)]);
    } else {
      file ??= await settingsFile(definition.id, options);
      stored ??= await readStored(file);
      if (Object.hasOwn(stored.values, key)) {
        result.push([key, assertValue(definition, key, stored.values[key], 'saved value')]);
      } else if (field.required && field.default === undefined) {
        throw new MissingSupportSettingError(definition.id, key, file, field.env);
      } else {
        result.push([key, field.default]);
      }
    }
  }
  return Object.fromEntries(result) as SupportSettingsValues<Definition>;
}

function parseEnv(field: SupportSettingField, text: string): unknown {
  if (field.type === 'number') {
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : text;
  }
  if (field.type === 'boolean') {
    if (text === 'true') return true;
    if (text === 'false') return false;
  }
  return text;
}

function assertValue(definition: SupportSettingsDefinition, key: string, value: unknown, source: string): SupportSettingValue {
  const message = invalidValue(definition.fields[key], value);
  if (message) throw new SupportSettingsError('invalid-field', `Support "${definition.id}", field "${key}" (${source}). ${message}`, key);
  return value as SupportSettingValue;
}

function invalidValue(field: SupportSettingField, value: unknown): string | undefined {
  switch (field.type) {
    case 'string':
      if (typeof value !== 'string') return 'Enter text.';
      if (/[\r\n]/.test(value)) return 'Enter a single line of text.';
      if (field.minLength !== undefined && value.length < field.minLength) return `Enter at least ${field.minLength} characters.`;
      if (field.maxLength !== undefined && value.length > field.maxLength) return `Enter at most ${field.maxLength} characters.`;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a finite number.';
      if (field.integer && !Number.isInteger(value)) return 'Enter a whole number.';
      if (field.min !== undefined && value < field.min) return `Enter a number greater than or equal to ${field.min}.`;
      if (field.max !== undefined && value > field.max) return `Enter a number less than or equal to ${field.max}.`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return 'Enter true or false.';
      break;
    case 'select':
      if (!field.options.some(option => option.value === value)) return 'Select one of the listed options.';
      break;
  }
}
