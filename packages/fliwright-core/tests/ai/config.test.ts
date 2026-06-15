import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiDisabledError, resolveAiConfig } from '../../src/index.js';
import { AiRuntime, CodexCliAdapter, MockAiAdapter } from '../../src/index.js';
import { parseAiArgs } from '../../src/ai/config.js';

const ENV_KEYS = [
  'FLIWRIGHT_AI_PROVIDER',
  'FLIWRIGHT_AI_ENABLED',
  'FLIWRIGHT_AI_TIMEOUT_MS',
  'FLIWRIGHT_AI_ARTIFACTS_DIR',
  'FLIWRIGHT_AI_CACHE',
  'FLIWRIGHT_AI_COMMAND',
  'FLIWRIGHT_AI_ARGS',
] as const;

const original: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('resolveAiConfig', () => {
  it('defaults to provider none and disabled when nothing is configured', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const config = resolveAiConfig(undefined);
    expect(config.provider).toBe('none');
    expect(config.enabled).toBe(false);
    expect(config.timeoutMs).toBe(60_000);
    expect(config.artifactsDir).toBe('.fliwright/ai');
    expect(config.cache).toBe('off');
  });

  it('reads provider and artifacts dir from environment', () => {
    process.env.FLIWRIGHT_AI_PROVIDER = 'mock';
    process.env.FLIWRIGHT_AI_ARTIFACTS_DIR = '.fliwright/ai-env';
    process.env.FLIWRIGHT_AI_TIMEOUT_MS = '1234';
    const config = resolveAiConfig(undefined);
    expect(config.provider).toBe('mock');
    expect(config.enabled).toBe(true);
    expect(config.artifactsDir).toBe('.fliwright/ai-env');
    expect(config.timeoutMs).toBe(1234);
    expect(config.adapter).toBeInstanceOf(MockAiAdapter);
  });

  it('parses comma-separated args', () => {
    process.env.FLIWRIGHT_AI_PROVIDER = 'codex';
    process.env.FLIWRIGHT_AI_ARGS = 'exec, --json';
    const config = resolveAiConfig(undefined);
    expect(config.adapter).toBeInstanceOf(CodexCliAdapter);
  });

  it('parseAiArgs splits, trims, and filters comma-separated input', () => {
    expect(parseAiArgs('exec, --json')).toEqual(['exec', '--json']);
    expect(parseAiArgs('  a , , b ')).toEqual(['a', 'b']);
    expect(parseAiArgs(undefined)).toBeUndefined();
  });

  it('respects an explicit adapter instance over provider-based construction', () => {
    const adapter = new MockAiAdapter();
    const config = resolveAiConfig({ provider: 'mock', adapter });
    expect(config.adapter).toBe(adapter);
  });
});

describe('AiRuntime via resolved config', () => {
  it('throws AiDisabledError when resolved config has no provider', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const runtime = new AiRuntime(resolveAiConfig(undefined));
    await expect(runtime.ask({ prompt: 'hi' })).rejects.toBeInstanceOf(AiDisabledError);
  });
});