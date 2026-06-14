import { describe, expect, it } from 'vitest';

import { MockAiAdapter } from '../../src/index.js';

describe('MockAiAdapter', () => {
  it('returns the next queued response', async () => {
    const adapter = new MockAiAdapter([{ text: '{"ok":true}', json: { ok: true } }]);

    const response = await adapter.invoke(
      { prompt: 'return ok', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    );

    expect(response.text).toBe('{"ok":true}');
    expect(response.json).toEqual({ ok: true });
  });

  it('throws queued errors', async () => {
    const adapter = new MockAiAdapter([new Error('adapter failed')]);

    await expect(
      adapter.invoke(
        { prompt: 'fail' },
        { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
      ),
    ).rejects.toThrow('adapter failed');
  });

  it('builds deterministic JSON from a handler', async () => {
    const adapter = new MockAiAdapter(async (request) => ({
      text: JSON.stringify({ prompt: request.prompt }),
      json: { prompt: request.prompt },
    }));

    const response = await adapter.invoke(
      { prompt: 'hello', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    );

    expect(response.json).toEqual({ prompt: 'hello' });
  });
});
