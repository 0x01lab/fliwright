import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
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
  it('uses the core project runs root for vscode workspace URIs', () => {
    const a = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    const b = projectRunsRoot(fakeUri('/repos/exio_app'), { homeDir: '/tmp/h' });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe('repos-exio_app');
    expect(a.runsDir).toBe('/repos/exio_app/.fliwright/runs');
  });

  it('keeps the legacy hash candidate for existing migrated data', () => {
    const root = fakeUri('/repos/exio_app');
    const candidates = projectRunsRootCandidates(root, { homeDir: '/tmp/h' });
    expect(candidates[0]?.hash).toBe('repos-exio_app');
    expect(candidates[1]?.hash).toBe(legacyProjectRunsRoot(root, { homeDir: '/tmp/h' }).hash);
  });

  it('ensures the configured run directory without a home metadata file', async () => {
    const project = mkdtempSync(join(tmpdir(), 'fliwright-project-'));
    const runsDir = await ensureProjectRunsRoot(fakeUri(project));
    expect(runsDir).toBe(join(project, '.fliwright/runs'));
    expect(existsSync(runsDir)).toBe(true);
    expect(existsSync(join(project, '.fliwright/meta.json'))).toBe(false);
  });

  it('re-exports core path sanitization', () => {
    expect(sanitizeProjectPathName('/Users/leo.he/projects/fliwright')).toBe('Users-leo.he-projects-fliwright');
  });
});
