import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureProjectRunsRoot,
  legacyProjectRunsRoot,
  projectRunsRoot,
  projectRunsRootCandidates,
  sanitizeProjectPathName,
} from '../src/testing/ProjectRunsRoot.js';

const fakeUri = (fsPath: string) => ({ fsPath, scheme: 'file' } as any);

describe('ProjectRunsRoot', () => {
  it('uses the workspace path as the project directory name', () => {
    const a = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    const b = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe('repos-exio_app');
    expect(a.runsDir).toBe(join('/tmp/h', '.fliwright', 'projects', 'repos-exio_app', 'runs'));
  });

  it('different paths map to different hashes', () => {
    const a = projectRunsRoot(fakeUri('/repos/A'), { homeDir: '/tmp/h' });
    const b = projectRunsRoot(fakeUri('/repos/B'), { homeDir: '/tmp/h' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('keeps the legacy hash candidate for existing migrated data', () => {
    const root = fakeUri('/repos/exio_app');
    const candidates = projectRunsRootCandidates(root, { homeDir: '/tmp/h' });
    expect(candidates[0]?.hash).toBe('repos-exio_app');
    expect(candidates[1]?.hash).toBe(legacyProjectRunsRoot(root, { homeDir: '/tmp/h' }).hash);
  });

  it('sanitizes slash-separated project paths like Claude Code project names', () => {
    expect(sanitizeProjectPathName('/Users/leo.he/projects/fliwright')).toBe('Users-leo.he-projects-fliwright');
    expect(sanitizeProjectPathName('C:\\Users\\leo\\repo')).toBe('C:-Users-leo-repo');
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
