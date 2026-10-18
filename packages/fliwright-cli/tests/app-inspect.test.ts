import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appDebugSnapshotCommand, appReloadCommand, appSourceMapCommand } from '../src/commands/app-inspect.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const snapshot = { snapshot: 'ready', refs: [], groupId: 'g', count: 0 };
it('preserves required snapshot and marks failed optional debug channels as partial', async () => {
  const driver = { page: { snapshot: async () => snapshot, context: async () => ({ route: '/cart' }), screenshot: vi.fn() } };
  const result = await appDebugSnapshotCommand({}, { sessionProvider: async () => ({ driver: driver as never, vmServiceUrl: 'ws://debug/ws' }) });
  expect(result).toMatchObject({ snapshot, partial: true, errors: [{ section: 'diagnostics' }, { section: 'mock' }] });
  expect(driver.page.screenshot).not.toHaveBeenCalled();
});
it('writes reload image bytes to a file and forwards source inspection options', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-reload-')); roots.push(root);
  const sourceMap = vi.fn(async () => ({ candidateFiles: ['cart.dart'] }));
  const driver = { reloadSources: async () => ({}), page: { snapshot: async () => snapshot, screenshot: async () => Buffer.from('png'), sourceMap } };
  const deps = { sessionProvider: async () => ({ driver: driver as never, vmServiceUrl: 'ws://debug/ws' }) };
  const result = await appReloadCommand({ cwd: root, includeScreenshot: true }, deps);
  expect(await readFile(result.screenshot!.path, 'utf8')).toBe('png');
  expect(result).not.toHaveProperty('base64');
  expect(await appSourceMapCommand({ limit: 25, includeFramework: false }, deps)).toMatchObject({ candidateFiles: ['cart.dart'] });
  expect(sourceMap).toHaveBeenCalledWith(expect.objectContaining({ limit: 25, includeFramework: false }));
});
it('returns reload errors as execution failures with captured evidence', async () => {
  const driver = { reloadSources: async () => { throw new Error('reload unavailable'); }, page: {} };
  await expect(appReloadCommand({}, { sessionProvider: async () => ({ driver: driver as never, vmServiceUrl: 'ws://debug/ws' }) })).rejects.toMatchObject({ code: 'RELOAD_FAILED', data: { reloaded: false } });
});
