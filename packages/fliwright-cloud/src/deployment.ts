import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Create a private loopback installation without overwriting existing configuration or secrets. */
export function initializeCloud(directory = '.fliwright/cloud'): string {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const configPath = join(root, 'server.json');
  const config = {
    dataRoot: './data', host: '127.0.0.1', port: 4780,
    publicUrl: 'http://127.0.0.1:4780', localUser: 'local', users: { local: 'admin' },
    proxySecret: randomBytes(32).toString('hex'),
    publicationSecret: randomBytes(32).toString('hex'),
    ciTokens: [], workerTokens: [], targets: [], workers: [],
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return configPath;
}
