import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  AiAssertionError,
  AiTimeoutError,
  AiRuntime,
  MockAiAdapter,
  type AgentSnapshotResult,
  type Page,
} from '../../src/index.js';

function pageStub(): Page {
  return {
    screenshot: vi.fn().mockResolvedValue(Buffer.from('png')),
    snapshot: vi.fn().mockResolvedValue({
      snapshot: '- button "Success" [ref=e1]',
      groupId: 'group-1',
      refs: [],
      count: 1,
    } satisfies AgentSnapshotResult),
  } as unknown as Page;
}

describe('AiRuntime', () => {
  it('generate returns schema-validated adapter JSON', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([{ text: '{"phone":"13800138000"}', json: { phone: '13800138000' } }]),
    });

    const value = await runtime.generate<{ phone: string }>({
      prompt: 'Generate a user',
      schema: {
        type: 'object',
        properties: { phone: { type: 'string' } },
        required: ['phone'],
      },
    });

    expect(value.phone).toBe('13800138000');
  });

  it('generate uses fallback when adapter invocation fails', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([new Error('provider down')]),
    });

    await expect(runtime.generate({
      prompt: 'Generate a user',
      schema: { type: 'object' },
      fallback: { phone: 'fallback' },
    })).resolves.toEqual({ phone: 'fallback' });
  });

  it('visible captures screenshot and snapshot, then passes on provider pass true', async () => {
    const page = pageStub();
    const adapter = new MockAiAdapter(async (request) => {
      expect(request.images?.[0]?.mimeType).toBe('image/png');
      expect(request.metadata?.snapshot).toEqual({
        snapshot: '- button "Success" [ref=e1]',
        groupId: 'group-1',
        refs: [],
        count: 1,
      });
      return { text: '{"pass":true,"reason":"looks good"}', json: { pass: true, reason: 'looks good' } };
    });
    const runtime = new AiRuntime({ adapter }, { page });

    await expect(runtime.visible('Success is visible', { includeSnapshot: true })).resolves.toBeUndefined();
    expect(page.screenshot).toHaveBeenCalledWith({ pixelRatio: 1 });
    expect(page.snapshot).toHaveBeenCalled();
  });

  it('visible throws AiAssertionError on provider pass false', async () => {
    const runtime = new AiRuntime(
      { adapter: new MockAiAdapter([{ text: '{"pass":false,"reason":"error banner"}', json: { pass: false, reason: 'error banner' } }]) },
      { page: pageStub() },
    );
    const result = runtime.visible('No error banner');

    await expect(result).rejects.toBeInstanceOf(AiAssertionError);
    await expect(result).rejects.toThrow('error banner');
  });

  it('inspect returns schema-validated visual JSON', async () => {
    const runtime = new AiRuntime(
      { adapter: new MockAiAdapter([{ text: '{"state":"success"}', json: { state: 'success' } }]) },
      { page: pageStub() },
    );

    await expect(runtime.inspect({
      prompt: 'Classify page state',
      schema: { type: 'object', properties: { state: { enum: ['success', 'error'] } }, required: ['state'] },
    })).resolves.toEqual({ state: 'success' });
  });

  it('classify only returns one of the supplied choices', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter([{ text: '{"label":"success"}', json: { label: 'success' } }]),
    });

    await expect(runtime.classify({ prompt: 'Classify', choices: ['success', 'error'] })).resolves.toBe('success');
  });

  it('writes artifacts for successful invocations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-runtime-'));
    const runtime = new AiRuntime(
      {
        artifactsDir: root,
        adapter: new MockAiAdapter([{ text: '{"ok":true}', json: { ok: true } }]),
      },
      { runId: 'run-1', testName: 'artifact test' },
    );

    const response = await runtime.ask({ prompt: 'Return ok', responseFormat: 'json' });

    expect(response.artifactsDir).toBeDefined();
    expect(await readFile(join(response.artifactsDir!, 'request.json'), 'utf8')).toContain('"prompt": "Return ok"');
    expect(await readFile(join(response.artifactsDir!, 'response.json'), 'utf8')).toContain('"ok": true');
    expect(await readFile(join(response.artifactsDir!, 'meta.json'), 'utf8')).toContain('"status": "passed"');
  });

  it('times out when an adapter does not settle', async () => {
    const runtime = new AiRuntime({
      adapter: new MockAiAdapter(() => new Promise(() => undefined)),
      timeoutMs: 1,
    });

    await expect(runtime.ask({ prompt: 'Hang' })).rejects.toBeInstanceOf(AiTimeoutError);
  });

  it('visible uses per-call page override instead of constructor context', async () => {
    const constructorPage = {
      screenshot: () => { throw new Error('constructor page must not be used'); },
      snapshot: () => { throw new Error('constructor page must not be used'); },
    } as unknown as Page;
    const callPage = pageStub();
    const adapter = new MockAiAdapter(async (request) => {
      expect(request.images?.[0]?.mimeType).toBe('image/png');
      return { text: '{"pass":true,"reason":"ok"}', json: { pass: true, reason: 'ok' } };
    });
    const runtime = new AiRuntime({ adapter }, { page: constructorPage });

    await expect(runtime.visible('looks good', {}, { page: callPage })).resolves.toBeUndefined();
    expect((callPage.screenshot as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('ask uses per-call testName and runId for the artifact directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-callctx-'));
    const runtime = new AiRuntime(
      { artifactsDir: root, adapter: new MockAiAdapter([{ text: '{"ok":true}', json: { ok: true } }]) },
      { runId: 'constructor-run', testName: 'constructor-test' },
    );

    const response = await runtime.ask({ prompt: 'hi', responseFormat: 'json' }, { runId: 'call-run', testName: 'call-test' });

    expect(response.artifactsDir).toContain('call-run');
    expect(response.artifactsDir).toContain('call-test');
    expect(response.artifactsDir).not.toContain('constructor');
  });
});
