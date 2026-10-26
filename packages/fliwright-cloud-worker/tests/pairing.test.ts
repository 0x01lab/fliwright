import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pairWorker } from '../src/pairing.js';
import { credential, discoveryConfigSchema, workerConfigSchema } from '../src/config.js';
const roots: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'pair-worker-')); roots.push(root); return root; };
it('saves a private credential and ready-to-use discovery config, refusing to overwrite or redeem twice', async () => {
  const root = temp(), directory = join(root, 'host');
  const token = 'synthetic-private-token-that-must-not-be-printed';
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workerId: 'mac', token }) });
  vi.stubGlobal('fetch', fetcher);
  const configPath = await pairWorker('https://cloud.test', 'abcd-1234-abcd-1234-abcd', directory);
  expect(fetcher).toHaveBeenCalledWith('https://cloud.test/api/worker/pair', expect.objectContaining({ redirect: 'error', body: JSON.stringify({ code: 'ABCD1234ABCD1234ABCD' }) }));
  const rawConfig = readFileSync(configPath, 'utf8');
  expect(rawConfig).not.toContain(token);
  const config = discoveryConfigSchema.parse(JSON.parse(rawConfig));
  expect(credential(config)).toBe(token);
  expect(config.credentialFile).toBe(join(directory, 'credentials.json'));
  expect(JSON.parse(rawConfig).workerId).toBeUndefined();
  if (process.platform !== 'win32') {
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(statSync(config.credentialFile!).mode & 0o777).toBe(0o600);
  }
  await expect(pairWorker('https://cloud.test', 'abcd1234abcd1234abcd', directory)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(workerConfigSchema.safeParse(config).success).toBe(false);
});
it('refuses insecure non-loopback URLs, URL credentials and malformed codes before making a request', async () => {
  const root = temp(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  for (const url of ['http://cloud.test', 'https://user:secret@cloud.test', 'file:///tmp/server', 'https://cloud.test/path', 'https://cloud.test?secret=x']) {
    await expect(pairWorker(url, 'ABCD1234ABCD1234ABCD', join(root, 'host'))).rejects.toThrow();
  }
  await expect(pairWorker('https://cloud.test', 'invalid', join(root, 'host'))).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('requires exactly one auth source and rejects permissive or mismatched stored credentials', () => {
  const root = temp(), file = join(root, 'credentials.json');
  const config = { serverUrl: 'https://cloud.test', credentialFile: file };
  expect(discoveryConfigSchema.safeParse(config).success).toBe(true);
  expect(discoveryConfigSchema.safeParse({ ...config, tokenEnv: 'TOKEN' }).success).toBe(false);
  expect(discoveryConfigSchema.safeParse({ serverUrl: config.serverUrl }).success).toBe(false);
  writeFileSync(file, JSON.stringify({ serverUrl: 'https://evil.test', workerId: 'mac', token: 'x'.repeat(40) }), { mode: 0o600 });
  expect(() => credential(config)).toThrow();
  writeFileSync(file, JSON.stringify({ serverUrl: config.serverUrl, workerId: 'mac', token: 'x'.repeat(40) }));
  expect(credential(config)).toBe('x'.repeat(40));
});
it('does not expose a returned token when redemption or persistence fails', async () => {
  const root = temp();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'private-server-content' }) }));
  await expect(pairWorker('http://127.0.0.1:4780', 'ABCD1234ABCD1234ABCD', join(root, 'host'))).rejects.toThrow('Pairing failed');
  expect(() => readFileSync(join(root, 'host', 'credentials.json'))).toThrow();
});
