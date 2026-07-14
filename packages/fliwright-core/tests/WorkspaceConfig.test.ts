import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearWorkspaceVmServiceUrl,
  readWorkspaceConfig,
  readWorkspaceConfigSync,
  workspaceConfigPath,
  writeWorkspaceE2eAutomation,
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

  it('writes and reads E2E automation runtime configuration', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-config-'));

    await writeWorkspaceE2eAutomation(true, {
      cwd,
      source: 'test-toggle',
      env: {
        FLIWRIGHT_E2E_AUTOMATION: 'true',
        EXIO_DISABLE_ALIYUN_CAPTCHA: 'true',
      },
      dartDefines: [
        'EXIO_E2E_AUTOMATION=true',
        'EXIO_DISABLE_ALIYUN_CAPTCHA=true',
      ],
    });

    const config = await readWorkspaceConfig(cwd);
    expect(config.e2eAutomation).toMatchObject({
      enabled: true,
      source: 'test-toggle',
      env: {
        FLIWRIGHT_E2E_AUTOMATION: 'true',
        EXIO_DISABLE_ALIYUN_CAPTCHA: 'true',
      },
      dartDefines: [
        'EXIO_E2E_AUTOMATION=true',
        'EXIO_DISABLE_ALIYUN_CAPTCHA=true',
      ],
    });
    expect(config.e2eAutomation?.updatedAt).toEqual(expect.any(String));
    expect(await readFile(workspaceConfigPath(cwd), 'utf-8')).toContain('"e2eAutomation"');
  });

  it('ignores invalid E2E automation fields while preserving custom fields', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-config-'));
    const filePath = workspaceConfigPath(cwd);
    await mkdir(join(cwd, '.fliwright'), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      version: 1,
      e2eAutomation: {
        enabled: true,
        env: {
          OK: 'yes',
          ignored: false,
        },
        dartDefines: ['A=true', 42],
        note: 'keep me',
      },
    }), 'utf-8');

    expect((await readWorkspaceConfig(cwd)).e2eAutomation).toEqual({
      enabled: true,
      env: { OK: 'yes' },
      dartDefines: ['A=true'],
      note: 'keep me',
    });
  });
});
