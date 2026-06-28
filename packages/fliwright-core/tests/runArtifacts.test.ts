import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureFliwrightRunsRoot,
  legacyProjectRunsRoot,
  projectRunsRoot,
  projectRunsRootCandidates,
  resolveFliwrightRunsRoot,
  sanitizeProjectPathName,
} from '../src/index.js';

describe('run artifact root resolution', () => {
  it('uses the workspace path as the project directory name', () => {
    const a = projectRunsRoot('/repos/exio_app', { homeDir: '/tmp/h' });
    const b = projectRunsRoot('/repos/exio_app', { homeDir: '/tmp/h' });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe('repos-exio_app');
    expect(a.runsDir).toBe(join('/tmp/h', '.fliwright', 'projects', 'repos-exio_app', 'runs'));
  });

  it('honors explicit root before env and default project root', () => {
    expect(resolveFliwrightRunsRoot({
      runsRoot: '/explicit/runs',
      projectRoot: '/repos/app',
      env: { FLIWRIGHT_RUNS_ROOT: '/env/runs' },
      homeDir: '/tmp/h',
    })).toBe('/explicit/runs');
  });

  it('honors FLIWRIGHT_RUNS_ROOT before the default project root', () => {
    expect(resolveFliwrightRunsRoot({
      projectRoot: '/repos/app',
      env: { FLIWRIGHT_RUNS_ROOT: '/env/runs' },
      homeDir: '/tmp/h',
    })).toBe('/env/runs');
  });

  it('falls back to the per-project home root', () => {
    expect(resolveFliwrightRunsRoot({
      projectRoot: '/repos/app',
      env: {},
      homeDir: '/tmp/h',
    })).toBe(join('/tmp/h', '.fliwright', 'projects', 'repos-app', 'runs'));
  });

  it('keeps the legacy hash candidate for existing migrated data', () => {
    const candidates = projectRunsRootCandidates('/repos/exio_app', { homeDir: '/tmp/h' });
    expect(candidates[0]?.hash).toBe('repos-exio_app');
    expect(candidates[1]?.hash).toBe(legacyProjectRunsRoot('/repos/exio_app', { homeDir: '/tmp/h' }).hash);
  });

  it('sanitizes slash-separated project paths like Claude Code project names', () => {
    expect(sanitizeProjectPathName('/Users/leo.he/projects/fliwright')).toBe('Users-leo.he-projects-fliwright');
    expect(sanitizeProjectPathName('C:\\Users\\leo\\repo')).toBe('C:-Users-leo-repo');
  });

  it('ensureFliwrightRunsRoot creates dirs and writes meta.json', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fliwright-home-'));
    const runsDir = await ensureFliwrightRunsRoot({
      projectRoot: '/repos/exio_app',
      homeDir: home,
      env: {},
    });
    expect(existsSync(runsDir)).toBe(true);
    const meta = JSON.parse(readFileSync(join(home, '.fliwright', 'projects', 'repos-exio_app', 'meta.json'), 'utf8'));
    expect(meta.projectPath).toBe('/repos/exio_app');
    expect(typeof meta.updatedAt).toBe('number');
  });
});
