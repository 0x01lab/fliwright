import RandExp from 'randexp';
import type { AiGenerateRequest } from './ai/types.js';
import type { FormFieldMeta, FormHelperOptions, FormRuleDataEntry } from './types.js';

export interface FormDataDslContext {
  field: FormFieldMeta;
  locale: string;
  options?: FormHelperOptions;
}

type ParsedDataEntry =
  | { kind: 'fixed'; value: string }
  | { kind: 'regex'; pattern: string }
  | {
      kind: 'ai';
      prompt: string;
      fallback?: string;
      system?: string;
      timeoutMs?: number;
      temperature?: number;
    };

export function generateFormDataEntry(
  entry: FormRuleDataEntry,
  context: FormDataDslContext,
): string | Promise<string> {
  const parsed = parseFormDataEntry(entry);
  switch (parsed.kind) {
    case 'fixed':
      return parsed.value;
    case 'regex':
      return new RandExp(new RegExp(parsed.pattern)).gen();
    case 'ai':
      return generateAiValue(parsed, context);
  }
}

function parseFormDataEntry(entry: FormRuleDataEntry): ParsedDataEntry {
  if (typeof entry === 'string') return parseStringEntry(entry);

  const value = fixedValue(entry.value);
  if (value !== undefined) return { kind: 'fixed', value };
  const fixed = fixedValue(entry.fixed);
  if (fixed !== undefined) return { kind: 'fixed', value: fixed };
  if (typeof entry.regex === 'string') return { kind: 'regex', pattern: entry.regex };
  if (typeof entry.regexp === 'string') return { kind: 'regex', pattern: entry.regexp };

  const prompt = entry.prompt ?? entry.ai;
  if (typeof prompt === 'string') {
    return {
      kind: 'ai',
      prompt,
      fallback: entry.fallback,
      system: entry.system,
      timeoutMs: entry.timeoutMs,
      temperature: entry.temperature,
    };
  }

  return { kind: 'fixed', value: '' };
}

function fixedValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(',');
  return undefined;
}

function parseStringEntry(value: string): ParsedDataEntry {
  const colon = value.indexOf(':');
  if (colon <= 0) return { kind: 'fixed', value };

  const prefix = value.slice(0, colon).trim().toLowerCase();
  const body = value.slice(colon + 1);
  switch (prefix) {
    case 'text':
    case 'literal':
    case 'fixed':
      return { kind: 'fixed', value: body };
    case 're':
    case 'regex':
    case 'regexp':
      return { kind: 'regex', pattern: body };
    case 'ai':
    case 'prompt':
      return { kind: 'ai', prompt: body };
    default:
      return { kind: 'fixed', value };
  }
}

async function generateAiValue(
  entry: Extract<ParsedDataEntry, { kind: 'ai' }>,
  context: FormDataDslContext,
): Promise<string> {
  if (!context.options?.aiRuntime) {
    if (entry.fallback !== undefined) return entry.fallback;
    throw new Error('Form rule AI data entry requires FormHelperOptions.aiRuntime or a fallback value.');
  }

  const request: AiGenerateRequest<{ value: string }> = {
    prompt: buildPrompt(entry.prompt, context),
    system: entry.system,
    temperature: entry.temperature,
    timeoutMs: entry.timeoutMs,
    schema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false,
    },
    ...(entry.fallback === undefined ? {} : { fallback: { value: entry.fallback } }),
  };
  const result = await context.options.aiRuntime.generate<{ value: string }>(request);
  return result.value;
}

function buildPrompt(prompt: string, context: FormDataDslContext): string {
  return [
    prompt,
    '',
    'Return JSON only: {"value":"..."}',
    'Generate exactly one value suitable for this Flutter form field.',
    `Locale: ${context.locale}`,
    `Field: ${JSON.stringify(formFieldPromptMetadata(context.field))}`,
  ].join('\n');
}

function formFieldPromptMetadata(field: FormFieldMeta): Record<string, unknown> {
  return {
    id: field.id,
    type: field.type,
    controlType: field.controlType,
    hintText: field.hintText,
    label: field.label,
    name: field.name,
    key: field.key,
    semanticsId: field.semanticsId,
    semanticsLabel: field.semanticsLabel,
    semanticsHint: field.semanticsHint,
    role: field.role,
    maxLength: field.maxLength,
  };
}
