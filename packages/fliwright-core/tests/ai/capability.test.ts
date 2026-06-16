import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AiDisabledError,
  AiInvocationError,
  ai,
  configureAi,
  type AgentSnapshotResult,
  type Page,
} from '../../src/index.js';

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

function pageStub(): Page {
  return {
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    snapshot: vi.fn().mockResolvedValue({
      snapshot: '- text "Success" [ref=e1]',
      groupId: 'group-1',
      refs: [],
      count: 1,
    } satisfies AgentSnapshotResult),
  } as unknown as Page;
}

beforeEach(() => {
  for (const key of ENV_KEYS) original[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  configureAi(undefined);
});

afterEach(() => {
  configureAi(undefined);
  for (const key of ENV_KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('ai namespace', () => {
  it('throws AiDisabledError when nothing is configured', async () => {
    await expect(ai.ask({ prompt: 'hi' })).rejects.toBeInstanceOf(AiDisabledError);
  });

  it('returns schema-validated JSON through a configured adapter', async () => {
    configureAi({
      adapter: {
        name: 'mock',
        invoke: async () => ({ text: '{"phone":"13800138000"}', json: { phone: '13800138000' } }),
      },
    });

    const value = await ai.generate<{ phone: string }>({
      prompt: 'Generate a user',
      schema: {
        type: 'object',
        properties: { phone: { type: 'string' } },
        required: ['phone'],
      },
    });

    expect(value).toEqual({ phone: '13800138000' });
  });

  it('returns fallback when generation fails', async () => {
    configureAi({
      adapter: {
        name: 'boom',
        invoke: async () => {
          throw new Error('down');
        },
      },
    });

    await expect(ai.generate({
      prompt: 'Generate a user',
      schema: { type: 'object' },
      fallback: { phone: 'fallback' },
    })).resolves.toEqual({ phone: 'fallback' });
  });

  it('classifies to one of the configured choices', async () => {
    configureAi({
      adapter: {
        name: 'mock',
        invoke: async () => ({ text: '{"label":"success"}', json: { label: 'success' } }),
      },
    });

    await expect(ai.classify({ prompt: 'Classify', choices: ['success', 'error'] })).resolves.toBe('success');
  });

  it('visible captures screenshot through the passed page', async () => {
    const page = pageStub();
    configureAi({
      adapter: {
        name: 'mock',
        invoke: async (request) => {
          expect(request.images?.[0]?.mimeType).toBe('image/png');
          return { text: '{"pass":true,"reason":"ok"}', json: { pass: true, reason: 'ok' } };
        },
      },
    });

    await expect(ai.visible('Success is visible', { page })).resolves.toBeUndefined();
    expect(page.screenshot).toHaveBeenCalledWith({ pixelRatio: 1 });
  });

  it('visible throws AiInvocationError when page is omitted', async () => {
    configureAi({ provider: 'mock' });

    await expect(ai.visible('Success is visible')).rejects.toBeInstanceOf(AiInvocationError);
  });

  it('inspect returns schema-validated visual JSON through the passed page', async () => {
    configureAi({
      adapter: {
        name: 'mock',
        invoke: async () => ({ text: '{"state":"success"}', json: { state: 'success' } }),
      },
    });

    await expect(ai.inspect<{ state: string }>({
      prompt: 'Classify page state',
      schema: {
        type: 'object',
        properties: { state: { enum: ['success', 'error'] } },
        required: ['state'],
      },
    }, { page: pageStub() })).resolves.toEqual({ state: 'success' });
  });

  it('rebuilds the shared runtime after configureAi is called again', async () => {
    configureAi({
      adapter: { name: 'first', invoke: async () => ({ text: 'first' }) },
    });
    await expect(ai.ask({ prompt: 'one' })).resolves.toMatchObject({ text: 'first' });

    configureAi({
      adapter: { name: 'second', invoke: async () => ({ text: 'second' }) },
    });

    await expect(ai.ask({ prompt: 'two' })).resolves.toMatchObject({ text: 'second' });
  });

  it('preserves unique artifact directories across successive calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-cap-'));
    configureAi({
      artifactsDir: root,
      adapter: {
        name: 'mock',
        invoke: async () => ({ text: '{"ok":true}', json: { ok: true } }),
      },
    });

    const first = await ai.ask({ prompt: 'one', responseFormat: 'json' }, { runId: 'r', testName: 't' });
    const second = await ai.ask({ prompt: 'two', responseFormat: 'json' }, { runId: 'r', testName: 't' });

    expect(first.artifactsDir).toContain('ai-1');
    expect(second.artifactsDir).toContain('ai-2');
  });
});
