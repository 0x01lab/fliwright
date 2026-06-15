import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AiArtifactStore } from '../../src/index.js';

describe('AiArtifactStore', () => {
  it('writes request, prompt, response, screenshot, snapshot, stderr, and meta artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-ai-artifacts-'));
    const store = new AiArtifactStore(root);
    const dir = await store.createInvocationDir({ runId: 'run/1', testName: 'signup submits', callId: 'call:1' });

    await store.writeRequest(dir, { prompt: 'Make data' });
    await store.writePrompt(dir, 'Make data');
    await store.writeResponseText(dir, 'ok');
    await store.writeResponseJson(dir, { ok: true });
    await store.writeScreenshot(dir, Buffer.from('png'));
    await store.writeSnapshot(dir, { snapshot: 'tree' });
    await store.writeStderr(dir, 'warning');
    await store.writeMeta(dir, { provider: 'mock', status: 'passed', durationMs: 7 });

    expect(await readFile(join(dir, 'request.json'), 'utf8')).toContain('"prompt": "Make data"');
    expect(await readFile(join(dir, 'prompt.md'), 'utf8')).toBe('Make data');
    expect(await readFile(join(dir, 'response.txt'), 'utf8')).toBe('ok');
    expect(await readFile(join(dir, 'response.json'), 'utf8')).toContain('"ok": true');
    expect(await readFile(join(dir, 'screenshot.png'))).toEqual(Buffer.from('png'));
    expect(await readFile(join(dir, 'snapshot.json'), 'utf8')).toContain('"snapshot": "tree"');
    expect(await readFile(join(dir, 'stderr.txt'), 'utf8')).toBe('warning');
    expect(await readFile(join(dir, 'meta.json'), 'utf8')).toContain('"provider": "mock"');
    expect(dir).toContain('run_1');
    expect(dir).toContain('signup_submits');
    expect(dir).toContain('call_1');
  });
});
