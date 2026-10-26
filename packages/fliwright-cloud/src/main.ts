#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { CloudStore, digest } from './CloudStore.js';
import { createCloudServer } from './server.js';
import {
  loadServerConfig,
  clientConfigSchema,
  loadJson,
  credential,
} from './config.js';
import { initializeCloud } from './deployment.js';
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
  if (!command || command === '--help' || command === '-h') {
    console.log(`Usage: fliwright-cloud <command> [config.json]

Commands:
  init [directory]  Create private local configuration (default: .fliwright/cloud)
  server [config]   Start Cloud in the foreground; stop with Ctrl+C or SIGTERM
  health [config]   Check the configured server's health
  hash-token        Hash FLIWRIGHT_CLOUD_TOKEN
  submit <config> <request.json> <idempotency-key>
  wait <config> <request-id>
  cancel <config> <request-id>
  backup <config> <new-backup-directory>

Server config: explicit argument, FLIWRIGHT_CLOUD_CONFIG, then .fliwright/cloud/server.json.
Relative dataRoot paths resolve beside server.json, independently of the working directory.
init enables loopback-only local access. For a team deployment, remove localUser and configure HTTPS identity proxying.`);
    return;
  }
  if (!['init', 'server', 'health', 'hash-token', 'submit', 'wait', 'cancel', 'backup'].includes(command)) {
    console.error('Unknown cloud command. Run fliwright-cloud --help.');
    process.exitCode = 1;
    return;
  }
  if (command === 'init') {
    const configPath = initializeCloud(path);
    console.log(`Cloud configuration created: ${configPath}`);
    console.log('Start: fliwright-cloud server (or pass this config path)');
    return;
  }
  if (command === 'hash-token') {
    const value = process.env.FLIWRIGHT_CLOUD_TOKEN;
    if (!value || value.length < 16)
      throw new Error('Set FLIWRIGHT_CLOUD_TOKEN (at least 16 characters)');
    console.log(digest(value));
    return;
  }
  if (command === 'health') {
    const config = loadServerConfig(path);
    const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host;
    const response = await fetch(`http://${host.includes(':') ? `[${host}]` : host}:${config.port}/healthz`, {
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!response.ok || (await response.json() as { status?: string }).status !== 'ok')
      throw new Error('Cloud health check failed');
    console.log('Cloud health: ok');
    return;
  }
  if (!path && command !== 'server')
    throw new Error(
      'Usage: fliwright-cloud <server|submit|wait|cancel|backup> <config.json> [request.json|requestId|backupDirectory]',
    );
  if (command === 'server') {
    const config = loadServerConfig(path);
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
    try { await server.listen({ host: config.host, port: config.port }); }
    catch (error) { await server.close(); store.close(); throw error; }
    console.log(
      `Cloud management server listening on ${config.host}:${config.port} (${config.publicUrl})`,
    );
    return;
  }
  if (command === 'backup') {
    const config = loadServerConfig(path),
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
  const config = clientConfigSchema.parse(loadJson(path!)),
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
main().catch((error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'EEXIST') console.error('Configuration already exists; existing configuration and secrets were preserved.');
  else if (code === 'ENOENT') console.error('Configuration or runtime file not found. Run fliwright-cloud init or set FLIWRIGHT_CLOUD_CONFIG.');
  else if (code === 'EADDRINUSE') console.error('Cloud port is already in use. Stop the existing instance or change port and publicUrl in server.json.');
  console.error(
    'Cloud operation failed. Check configuration, credentials and server diagnostics.',
  );
  process.exitCode = 1;
});
