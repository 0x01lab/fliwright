import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectRunsRoot, ensureProjectRunsRoot } from '../src/testing/ProjectRunsRoot.js';

const fakeUri = (fsPath: string) => ({ fsPath, scheme: 'file' } as any);

describe('ProjectRunsRoot', () => {
  it('produces a stable hash for a workspace path', () => {
    const a = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    const b = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    expect(a.hash).toBe(b.hash);
    expect(a.runsDir).toBe(join('/tmp/h', '.fliwright', 'projects', a.hash, 'runs'));
  });

  it('different paths map to different hashes', () => {
    const a = projectRunsRoot(fakeUri('/repos/A'), { homeDir: '/tmp/h' });
    const b = projectRunsRoot(fakeUri('/repos/B'), { homeDir: '/tmp/h' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('ensureProjectRunsRoot creates dirs and writes meta.json', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const runsDir = await ensureProjectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: home });
    expect(existsSync(runsDir)).toBe(true);
    const meta = JSON.parse(readFileSync(join(home, '.fliwright', 'projects', projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: home }).hash, 'meta.json'), 'utf8'));
    expect(meta.projectPath).toBe('/repos/exio_app');
    expect(typeof meta.updatedAt).toBe('number');
  });
});
