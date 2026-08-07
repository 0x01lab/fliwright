import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DevAssistTraceStore,
  buildChangeSetSnapshot,
  redactDevAssistTrace,
} from '../../src/index.js';

describe('DevAssistTrace', () => {
  it('creates deterministic change summaries without retaining source content', () => {
    const first = buildChangeSetSnapshot({
      baseRevision: 'abc123',
      files: [
        { path: 'lib/markets.dart', status: 'modified', content: 'const title = "Markets";' },
        { path: 'test/markets.test.ts', status: 'added', content: 'test("markets", () => {});' },
      ],
    });
    const second = buildChangeSetSnapshot({
      baseRevision: 'abc123',
      files: [...first.files].reverse().map((file) => ({
        ...file,
        content: file.path === 'lib/markets.dart'
          ? 'const title = "Markets";'
          : 'test("markets", () => {});',
      })),
    });

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('const title');
    expect(first.files).toEqual([
      expect.objectContaining({ path: 'lib/markets.dart', status: 'modified' }),
      expect.objectContaining({ path: 'test/markets.test.ts', status: 'added' }),
    ]);
  });

  it('persists a redacted, stable session manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-devassist-trace-'));
    const store = new DevAssistTraceStore({ root });
    const trace = redactDevAssistTrace({
      version: 1,
      devAssistSessionId: 'session-1',
      request: 'Verify Markets with Authorization: Bearer secret-token',
      changeSets: [],
      inference: {
        promptTemplateVersion: 'devassist-v1',
        provider: 'mock',
        evidence: { changeFiles: ['lib/markets.dart'] },
      },
      candidate: {
        path: '.fliwright/generated/session-1.test.ts',
        hash: 'candidate-hash',
        testName: 'opens Markets',
        validation: { eligible: true },
      },
      cycles: [],
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
    });

    const path = await store.write(trace);

    expect(path).toBe(join(root, 'session-1.json'));
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(trace);
    expect(JSON.stringify(trace)).not.toContain('secret-token');
  });
});
