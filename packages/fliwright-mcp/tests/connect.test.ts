import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createServerState } from '../src/state.js';
import { handleConnect, handleStatus, resolveMcpVmServiceUrl } from '../src/tools/connect.js';

function fakeDriver() {
  return {
    connect: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
}

describe('handleConnect', () => {
  it('connects from FLIWRIGHT_VM_SERVICE_URL when vmServiceUrl is omitted', async () => {
    const state = createServerState();
    const driver = fakeDriver();

    const result = await handleConnect({}, state, {
      env: { FLIWRIGHT_VM_SERVICE_URL: 'http://127.0.0.1:54321/abc/' },
      driverFactory: () => driver,
    });

    expect(driver.connect).toHaveBeenCalledWith('ws://127.0.0.1:54321/abc/ws');
    expect(state.getDriver()).toBe(driver);
    expect(state.getVmServiceUrl()).toBe('http://127.0.0.1:54321/abc/');
    expect(result).toMatchObject({
      connected: true,
      vmServiceUrl: 'http://127.0.0.1:54321/abc/',
      source: 'env:FLIWRIGHT_VM_SERVICE_URL',
    });
  });

  it('connects from workspace config when vmServiceUrl and env are omitted', async () => {
    const cwd = join(tmpdir(), `fliwright-mcp-connect-${Date.now()}`);
    await mkdir(join(cwd, '.fliwright'), { recursive: true });
    await writeFile(join(cwd, '.fliwright', 'config.json'), JSON.stringify({
      version: 1,
      vmServiceUrl: 'http://127.0.0.1:8181/root/',
    }), 'utf-8');
    const state = createServerState();
    const driver = fakeDriver();

    const result = await handleConnect({}, state, {
      cwd,
      env: {},
      driverFactory: () => driver,
    });

    expect(driver.connect).toHaveBeenCalledWith('ws://127.0.0.1:8181/root/ws');
    expect(result.source).toBe('workspace-config');
  });

  it('reports ordinary app interaction status separately from the TDD runtime', async () => {
    const state = createServerState();

    const status = await handleStatus(state, {
      env: { FLIWRIGHT_VM_URL: 'http://127.0.0.1:54321/status/' },
    });

    expect(status).toMatchObject({
      tool: 'fliwright_status',
      connected: false,
      availableVmServiceUrl: 'http://127.0.0.1:54321/status/',
      availableVmServiceUrlSource: 'env:FLIWRIGHT_VM_URL',
    });
    expect(status.guidance).toContain('fliwright_screenshot');
    expect(status.tddRuntimeTool).toBe('fliwright_tdd_status');
  });
});

describe('resolveMcpVmServiceUrl', () => {
  it('prefers an explicit URL over state and environment', async () => {
    const state = createServerState();
    state.setVmServiceUrl('http://state-url/');

    const resolved = await resolveMcpVmServiceUrl({
      explicit: 'http://explicit-url/',
      state,
      env: { FLIWRIGHT_VM_URL: 'http://env-url/' },
    });

    expect(resolved).toEqual({
      vmServiceUrl: 'http://explicit-url/',
      source: 'argument',
    });
  });
});
