import { CliJsonAdapter } from './adapters/CliJsonAdapter.js';
import { ClaudeCliAdapter } from './adapters/ClaudeCliAdapter.js';
import { CodexCliAdapter } from './adapters/CodexCliAdapter.js';
import { MockAiAdapter } from './adapters/MockAiAdapter.js';
import type { AiAdapter, AiCliAdapterOptions, AiProviderName, AiRuntimeConfig } from './types.js';

export function resolveAiConfig(config: AiRuntimeConfig | undefined): AiRuntimeConfig {
  const explicitAdapter = isAiAdapter(config?.adapter) || isAiCliAdapterOptions(config?.adapter);
  const provider = config?.provider ?? (explicitAdapter ? 'custom-cli' : parseAiProvider(process.env.FLIWRIGHT_AI_PROVIDER));
  const adapter = isAiAdapter(config?.adapter) ? config?.adapter : createAiAdapter(config);
  return {
    provider,
    timeoutMs: config?.timeoutMs ?? parsePositiveInt(process.env.FLIWRIGHT_AI_TIMEOUT_MS) ?? 60_000,
    artifactsDir: config?.artifactsDir ?? process.env.FLIWRIGHT_AI_ARTIFACTS_DIR ?? '.fliwright/ai',
    cache: config?.cache ?? parseAiCache(process.env.FLIWRIGHT_AI_CACHE),
    maxConcurrency: config?.maxConcurrency ?? 1,
    enabled: config?.enabled ?? parseAiEnabled(process.env.FLIWRIGHT_AI_ENABLED, provider),
    defaultVisionContext: config?.defaultVisionContext,
    adapter,
  };
}

function createAiAdapter(config: AiRuntimeConfig | undefined): AiAdapter | undefined {
  if (isAiCliAdapterOptions(config?.adapter)) return new CliJsonAdapter(config.adapter);
  const provider = config?.provider ?? parseAiProvider(process.env.FLIWRIGHT_AI_PROVIDER);
  if (provider === 'mock') return new MockAiAdapter();
  if (provider === 'claude') {
    return new ClaudeCliAdapter({
      command: process.env.FLIWRIGHT_AI_COMMAND ?? 'claude',
      args: parseAiArgs(process.env.FLIWRIGHT_AI_ARGS),
    });
  }
  if (provider === 'codex') {
    return new CodexCliAdapter({
      command: process.env.FLIWRIGHT_AI_COMMAND ?? 'codex',
      args: parseAiArgs(process.env.FLIWRIGHT_AI_ARGS) ?? ['exec', '--json'],
    });
  }
  if (provider === 'custom-cli') {
    const command = process.env.FLIWRIGHT_AI_COMMAND;
    return command ? new CliJsonAdapter({ provider: 'custom-cli', command, args: parseAiArgs(process.env.FLIWRIGHT_AI_ARGS) }) : undefined;
  }
  return undefined;
}

export function parseAiProvider(value: string | undefined): AiProviderName {
  if (value === 'mock' || value === 'claude' || value === 'codex' || value === 'custom-cli' || value === 'none') return value;
  return 'none';
}

export function parseAiCache(value: string | undefined): AiRuntimeConfig['cache'] {
  if (value === 'read' || value === 'write' || value === 'read-write') return value;
  return 'off';
}

export function parseAiEnabled(value: string | undefined, provider: AiRuntimeConfig['provider']): boolean {
  if (value === 'false') return false;
  if (value === 'true') return true;
  return provider !== 'none';
}

export function parseAiArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((arg) => arg.trim()).filter(Boolean);
}

export function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function isAiAdapter(adapter: AiRuntimeConfig['adapter'] | undefined): adapter is AiAdapter {
  return Boolean(adapter && 'invoke' in adapter);
}

export function isAiCliAdapterOptions(adapter: AiRuntimeConfig['adapter'] | undefined): adapter is AiCliAdapterOptions {
  return Boolean(adapter && 'command' in adapter);
}
