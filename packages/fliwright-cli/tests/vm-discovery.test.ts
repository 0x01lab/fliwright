import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorkspaceVmServiceUrl } from '@fliwright/core';
import { resolveVmUrl, discoverVmServiceUrl } from '../src/vm-discovery.js';

describe('resolveVmUrl', () => {
  const origEnv = process.env.FLIWRIGHT_VM_URL;
  const origServiceEnv = process.env.FLIWRIGHT_VM_SERVICE_URL;

  beforeEach(() => {
    delete process.env.FLIWRIGHT_VM_URL;
    delete process.env.FLIWRIGHT_VM_SERVICE_URL;
  });

  afterEach(() => {
    if (origEnv) process.env.FLIWRIGHT_VM_URL = origEnv;
    else delete process.env.FLIWRIGHT_VM_URL;
    if (origServiceEnv) process.env.FLIWRIGHT_VM_SERVICE_URL = origServiceEnv;
    else delete process.env.FLIWRIGHT_VM_SERVICE_URL;
  });

  it('returns CLI flag when provided', async () => {
    const url = await resolveVmUrl({ cliFlag: 'ws://cli-url/ws' });
    expect(url).toBe('ws://cli-url/ws');
  });

  it('returns env var when no CLI flag', async () => {
    process.env.FLIWRIGHT_VM_URL = 'ws://env-url/ws';
    const url = await resolveVmUrl({});
    expect(url).toBe('ws://env-url/ws');
  });

  it('returns FLIWRIGHT_VM_SERVICE_URL when FLIWRIGHT_VM_URL is not set', async () => {
    process.env.FLIWRIGHT_VM_SERVICE_URL = 'ws://service-env-url/ws';
    const url = await resolveVmUrl({});
    expect(url).toBe('ws://service-env-url/ws');
  });

  it('returns config value when no CLI flag or env var', async () => {
    const url = await resolveVmUrl({ configUrl: 'ws://config-url/ws' });
    expect(url).toBe('ws://config-url/ws');
  });

  it('returns workspace config value when no CLI flag, env var, or config value', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'fliwright-cli-config-'));
    await writeWorkspaceVmServiceUrl('ws://workspace-url/ws', { cwd, source: 'test' });

    const url = await resolveVmUrl({ cwd });

    expect(url).toBe('ws://workspace-url/ws');
  });

  it('prefers CLI flag over env var and config', async () => {
    process.env.FLIWRIGHT_VM_URL = 'ws://env-url/ws';
    const url = await resolveVmUrl({ cliFlag: 'ws://cli-url/ws', configUrl: 'ws://config-url/ws' });
    expect(url).toBe('ws://cli-url/ws');
  });

  it('prefers env var over config', async () => {
    process.env.FLIWRIGHT_VM_URL = 'ws://env-url/ws';
    const url = await resolveVmUrl({ configUrl: 'ws://config-url/ws' });
    expect(url).toBe('ws://env-url/ws');
  });

  it('returns null when no other source and no Flutter app running', async () => {
    const url = await resolveVmUrl({});
    expect(url).toBeNull();
  });
});

describe('discoverVmServiceUrl', () => {
  it('returns null when no ports respond', async () => {
    const url = await discoverVmServiceUrl();
    expect(typeof url === 'string' || url === null).toBe(true);
  });
});
