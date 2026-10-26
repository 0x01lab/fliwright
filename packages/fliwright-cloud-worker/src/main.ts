#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { pairWorker } from './pairing.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { WorkerControlClient, CloudError } from '@fliwright/cloud-protocol';
import {
  workerConfigSchema,
  discoveryConfigSchema,
  hostConfigSchema,
  loadJson,
  credential,
} from './config.js';
import { createWorker, retrySpool } from './worker.js';
import { reportWorkerDevices } from './device-reporting.js';
import { runCatalogScanner } from './catalog-scanner.js';
import { executeJob } from './executor.js';
import { runCommandProcess } from './processes.js';
import { executorTimeline } from './worker-timeline-ipc.js';
import { runHostWorker } from './host.js';
import { installLocalPackages } from './local-packages.js';
const [command, path] = process.argv.slice(2);
const stop = new AbortController();
function installStop() {
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
}
async function waitForGo() {
  if (!process.send) throw new Error('Executor requires supervisor IPC');
  await new Promise<void>((resolve, reject) => {
    process.once('message', (message) => {
      if (
        message &&
        typeof message === 'object' &&
        'go' in message &&
        message.go === true
      )
        resolve();
      else reject(new Error('Invalid supervisor message'));
    });
    process.once('disconnect', () =>
      reject(new Error('Supervisor disconnected')),
    );
  });
}
async function main() {
  if (!command || command === '--help' || command === '-h') {
    console.log(`Usage: fliwright-worker <command> <config.json>

Commands:
  pair <server-url> <new-directory>  Pair this host with Cloud (prompts for code)
  run            Automatically bind managed devices, scan repositories and execute tasks
  discover       Report host devices without an execution slot
  recover        Verify cleanup and recover an isolated slot
  retry-uploads  Retry retained report uploads without executing tests
  install-local-packages <bundle.json>  Install packed build dependencies in the current checkout

Each Worker connects to the Cloud Server configured by serverUrl.
Credentials use credentialFile after pairing, or a configured tokenEnv.`);
    return;
  }
  if (command === 'install-local-packages') {
    if (!path) throw new Error('A local package bundle manifest is required');
    await installLocalPackages(process.cwd(), path);
    console.log('Local build packages installed into checkout.');
    return;
  }
  if (command === 'pair') {
    const directory = process.argv[4];
    if (!path || !directory) throw new Error('Usage: fliwright-worker pair <server-url> <new-directory>');
    const input = createInterface({ input: process.stdin, output: process.stdout });
    let code: string;
    try { code = await input.question('Cloud 配对码：'); } finally { input.close(); }
    const configPath = await pairWorker(path, code, directory);
    console.log(`配对成功，配置已保存：${configPath}`);
    console.log(`启动 Worker：fliwright-worker run ${JSON.stringify(configPath)}`);
    console.log('在 Cloud 选择纳管设备和允许的应用，执行槽位与本机配置将自动同步。');
    return;
  }
  if (!path)
    throw new Error(
      'Usage: fliwright-worker <run|discover|recover|retry-uploads> <config.json>',
    );
  if (command === 'execute' || command === 'reset') {
    installStop();
    let forced: NodeJS.Timeout | undefined;
    const disconnected = () => {
      stop.abort();
      forced = setTimeout(() => process.kill(-process.pid, 'SIGKILL'), 12000);
    };
    process.once('disconnect', disconnected);
    await waitForGo();
    try {
      if (command === 'execute') {
        process.send?.({ ready: true });
        await executeJob(path, stop.signal);
        // Keep the leader alive so the supervisor can verify its identity and reap the whole group.
        process.send?.({ done: true });
        if (!stop.signal.aborted)
          await new Promise<void>((resolve) =>
            stop.signal.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
      } else {
        const { commands, deviceId, directory, parentSpanId } = loadJson(path) as {
          commands: Array<{
            program: string;
            args: string[];
            acceptExitCodes?: number[];
          }>;
          deviceId: string;
          directory: string;
          parentSpanId?: string;
        };
        const telemetry = executorTimeline();
        try {
        for (const [commandIndex, cmd] of commands.entries())
          await telemetry.channel.run('device.reset.after', () => runCommandProcess(
            {
              ...cmd,
              args: cmd.args.map((a) => a.replaceAll('{deviceId}', deviceId)),
            },
            directory,
            join(directory, 'reset.log'),
            stop.signal,
          ), { parentSpanId, operation: 'command', commandIndex, signal: stop.signal });
        } finally { telemetry.dispose(); }
      }
    } finally {
      if (forced) clearTimeout(forced);
      process.removeListener('disconnect', disconnected);
      process.disconnect?.();
    }
    return;
  }
  if (command === 'discover') {
    const config = discoveryConfigSchema.parse(loadJson(path));
    installStop();
    const control = new WorkerControlClient(config.serverUrl, credential(config));
    try {
      await control.ready(stop.signal);
      await reportWorkerDevices(control, { signal: stop.signal, tools: config.deviceTools });
    } catch (error) {
      if (!stop.signal.aborted) throw error;
    } finally { control.close(); }
    return;
  }
  if (['run', 'recover', 'retry-uploads'].includes(command)) {
    const input = loadJson(path);
    if (command === 'run' && input && typeof input === 'object' && !('slotId' in input)) {
      installStop();
      await runHostWorker(hostConfigSchema.parse(input), path, stop.signal);
      return;
    }
    const config = workerConfigSchema.parse(input);
    if (command === 'retry-uploads') {
      await retrySpool(config);
      console.log('Retained publications processed');
      return;
    }
    installStop();
    const control = new WorkerControlClient(config.serverUrl, credential(config));
    try {
      const worker = createWorker(config, control);
      if (command === 'recover') {
        await worker.recover();
        console.log('Device reset verified; slot recovered');
        return;
      }
      try { await control.ready(stop.signal); }
      catch (error) { if (!stop.signal.aborted) throw error; }
      if (stop.signal.aborted) return;
      const inventory = reportWorkerDevices(control, { signal: stop.signal, tools: config.deviceTools });
      const scans = runCatalogScanner(control, { root: join(config.root, 'catalogs'), signal: stop.signal, credentialHomes: config.repositoryCredentialHomes });
      try {
        while (!stop.signal.aborted) {
          const revision = control.revision;
          let claimed = false;
          try { claimed = await worker.runOnce(stop.signal); }
          catch (error) {
            if (stop.signal.aborted) break;
            // An interrupted execution must be recovered locally, even after reconnect.
            if (existsSync(join(config.root, 'slot.lock')) || error instanceof CloudError || control.connected) throw error;
          }
          if (!claimed) await control.waitForWork(revision, stop.signal);
        }
      } catch (error) {
        if (!stop.signal.aborted) throw error;
      } finally {
        stop.abort();
        await Promise.all([inventory, scans]);
      }
    } finally { control.close(); }
    return;
  }
  throw new Error('Unknown Worker command');
}
main().catch(() => {
  console.error(
    'Worker operation failed. Check configuration, credentials and local diagnostics; existing slot locks require recovery. If pairing may have been consumed, revoke it in Cloud and generate a new code using a new directory.',
  );
  process.exitCode = 1;
});
