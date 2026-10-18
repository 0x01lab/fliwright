import { existsSync, mkdtempSync } from 'node:fs';
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
  resolveFliwrightCacheRoot,
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

  it('defaults to runs inside the project without using the home directory', () => {
    expect(resolveFliwrightRunsRoot({
      projectRoot: '/repos/app',
      env: {},
      homeDir: '/tmp/h',
    })).toBe('/repos/app/.fliwright/runs');
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

  it('resolves relative run and cache roots against the project independently', () => {
    expect(resolveFliwrightRunsRoot({ projectRoot: '/repos/app', runsRoot: 'evidence/runs', env: {} }))
      .toBe('/repos/app/evidence/runs');
    expect(resolveFliwrightCacheRoot({ projectRoot: '/repos/app' })).toBe('/repos/app/.fliwright/cache');
    expect(resolveFliwrightCacheRoot({ projectRoot: '/repos/app', cacheRoot: 'scratch' })).toBe('/repos/app/scratch');
  });

  it('ensures only the configured project-local run directory', async () => {
    const project = mkdtempSync(join(tmpdir(), 'fliwright-project-'));
    const runsDir = await ensureFliwrightRunsRoot({ projectRoot: project, env: {} });
    expect(runsDir).toBe(join(project, '.fliwright/runs'));
    expect(existsSync(runsDir)).toBe(true);
    expect(existsSync(join(project, '.fliwright/meta.json'))).toBe(false);
  });
});
