import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudStore } from '../src/CloudStore.js';
import { createCloudServer } from '../src/server.js';
import { serverConfigSchema } from '../src/config.js';

const cleanup: Array<() => unknown> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const config = {
  dataRoot: './data', host: '127.0.0.1', publicUrl: 'http://127.0.0.1:4780',
  localUser: 'local', users: { local: 'admin' as const },
  proxySecret: 'synthetic-proxy-secret', publicationSecret: 'synthetic-publication-secret',
  ciTokens: [], workerTokens: [],
};

it('limits local browser identity to loopback peers and the configured Host and Origin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-local-auth-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new CloudStore(join(root, 'db'));
  cleanup.push(() => store.close());
  const server = createCloudServer({ ...config, store, dataRoot: join(root, 'reports') });
  cleanup.push(() => server.close());
  const request = (options = {}) => server.inject({ url: '/api/me', headers: { host: '127.0.0.1:4780' }, remoteAddress: '127.0.0.1', ...options });
  expect((await request()).json()).toMatchObject({ name: 'local', role: 'admin' });
  expect((await request({ remoteAddress: '192.0.2.1' })).statusCode).toBe(401);
  expect((await request({ headers: { host: 'attacker.example:4780' } })).statusCode).toBe(401);
  expect((await request({ headers: { host: '127.0.0.1:4780', origin: 'https://attacker.example' } })).statusCode).toBe(403);
  expect((await request({ method: 'POST', url: '/api/projects', payload: {} })).statusCode).toBe(403);
  expect((await request({ method: 'POST', url: '/api/projects', headers: { host: '127.0.0.1:4780', origin: config.publicUrl }, payload: {} })).statusCode).toBe(400);
  expect((await request({ headers: { host: '127.0.0.1:4780', authorization: 'Bearer invalid' } })).statusCode).toBe(401);
});

it('rejects local identity in a public or wildcard deployment and requires a registered local user', () => {
  expect(serverConfigSchema.safeParse(config).success).toBe(true);
  for (const change of [{ host: '0.0.0.0' }, { publicUrl: 'https://cloud.example.com' }, { localUser: 'unknown' }]) {
    expect(serverConfigSchema.safeParse({ ...config, ...change }).success).toBe(false);
  }
});
