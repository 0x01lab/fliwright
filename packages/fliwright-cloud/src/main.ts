#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { CloudStore, digest } from './CloudStore.js';
import { createCloudServer } from './server.js';
import {
  serverConfigSchema,
  clientConfigSchema,
  loadJson,
  credential,
} from './config.js';
import {
  CloudClient,
  passesGitLabGate,
  submissionSchema,
  type GitLabGateRequest,
} from '@fliwright/cloud-protocol';

const [command, path, ...args] = process.argv.slice(2);
const stop = new AbortController();
function installStop() {
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
}
async function main() {
  if (command === 'hash-token') {
    const value = process.env.FLIWRIGHT_CLOUD_TOKEN;
    if (!value || value.length < 16)
      throw new Error('Set FLIWRIGHT_CLOUD_TOKEN (at least 16 characters)');
    console.log(digest(value));
    return;
  }
  if (!path)
    throw new Error(
      'Usage: fliwright-cloud <server|submit|wait|cancel|backup> <config.json> [request.json|requestId|backupDirectory]',
    );
  if (command === 'server') {
    const config = serverConfigSchema.parse(loadJson(path));
    mkdirSync(config.dataRoot, { recursive: true, mode: 0o700 });
    const store = new CloudStore(join(config.dataRoot, 'cloud.sqlite'));
    store.configure(config.targets, config.workers);
    const server = createCloudServer({
      ...config,
      store,
      dataRoot: join(config.dataRoot, 'reports'),
    });
    installStop();
    stop.signal.addEventListener(
      'abort',
      () => {
        void server.close().then(() => store.close());
      },
      { once: true },
    );
    await server.listen({ host: config.host, port: config.port });
    console.log(
      `Cloud management server listening on ${config.host}:${config.port}`,
    );
    return;
  }
  if (command === 'backup') {
    const config = serverConfigSchema.parse(loadJson(path)),
      destination = args[0];
    if (!destination || existsSync(destination))
      throw new Error('Provide a new backup directory');
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    const store = new CloudStore(join(config.dataRoot, 'cloud.sqlite'));
    try {
      const { cpSync } = await import('node:fs');
      cpSync(join(config.dataRoot, 'reports'), join(destination, 'reports'), {
        recursive: true,
      });
      const sql = resolve(destination, 'cloud.sqlite').replaceAll("'", "''");
      store.db.exec(`VACUUM INTO '${sql}'`);
    } finally {
      store.close();
    }
    console.log(
      'Backup saved; stop server and worker before backup for a consistent snapshot',
    );
    return;
  }
  const config = clientConfigSchema.parse(loadJson(path)),
    client = new CloudClient(config.serverUrl, credential(config.tokenEnv));
  if (command === 'submit') {
    if (!args[0] || !args[1])
      throw new Error('submit requires request.json and idempotency key');
    console.log(
      JSON.stringify(
        await client.request('/api/requests', {
          method: 'POST',
          body: submissionSchema.parse(loadJson(args[0])),
          key: args[1],
        }),
      ),
    );
    return;
  }
  if (command === 'cancel') {
    console.log(
      JSON.stringify(
        await client.request(
          `/api/requests/${encodeURIComponent(args[0] ?? '')}/cancel`,
          { method: 'POST' },
        ),
      ),
    );
    return;
  }
  if (command === 'wait') {
    if (!args[0]) throw new Error('wait requires request ID');
    const deadline = Date.now() + config.waitTimeoutMs;
    while (Date.now() < deadline) {
      const request = await client.request<GitLabGateRequest>(
        `/api/requests/${encodeURIComponent(args[0])}`,
      );
      if (
        ['completed', 'cancelled', 'infrastructure_failed'].includes(
          request.state,
        )
      ) {
        console.log(JSON.stringify(request));
        if (!passesGitLabGate(request)) process.exitCode = 1;
        return;
      }
      await delay(config.pollMs);
    }
    process.exitCode = 2;
    console.error(
      'Wait timed out; the platform task continues until explicitly cancelled',
    );
    return;
  }
  throw new Error('Unknown cloud command');
}
main().catch(() => {
  console.error(
    'Cloud operation failed. Check configuration, credentials and server diagnostics.',
  );
  process.exitCode = 1;
});
