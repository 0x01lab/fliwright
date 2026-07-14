import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearWorkspaceVmServiceUrl,
  readWorkspaceConfig,
  readWorkspaceConfigSync,
  workspaceConfigPath,
  writeWorkspaceVmServiceUrl,
} from '../src/index.js';

describe('WorkspaceConfig', () => {
  it('writes, reads, and clears the workspace VM Service URL', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-config-'));

    await writeWorkspaceVmServiceUrl('ws://127.0.0.1:12345/ws', {
      cwd,
      source: 'test',
    });

    expect(await readWorkspaceConfig(cwd)).toMatchObject({
      version: 1,
      vmServiceUrl: 'ws://127.0.0.1:12345/ws',
      vmServiceSource: 'test',
    });
    expect(readWorkspaceConfigSync(cwd).vmServiceUrl).toBe('ws://127.0.0.1:12345/ws');
    expect(await readFile(workspaceConfigPath(cwd), 'utf-8')).toContain('"vmServiceUrl"');

    await clearWorkspaceVmServiceUrl({ cwd, source: 'test-clear' });

    expect(await readWorkspaceConfig(cwd)).toMatchObject({
      version: 1,
      vmServiceSource: 'test-clear',
    });
    expect((await readWorkspaceConfig(cwd)).vmServiceUrl).toBeUndefined();
  });

  it('ignores invalid VM Service metadata while preserving custom config fields', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-config-'));
    const filePath = workspaceConfigPath(cwd);
    await mkdir(join(cwd, '.fliwright'), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      version: 99,
      vmServiceUrl: 123,
      vmServiceSource: false,
      featureFlag: true,
    }), 'utf-8');

    expect(await readWorkspaceConfig(cwd)).toEqual({
      version: 1,
      featureFlag: true,
    });
  });

});
