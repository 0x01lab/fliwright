#!/usr/bin/env node
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CloudClient } from '@fliwright/cloud-protocol';
import {
  workerConfigSchema,
  discoveryConfigSchema,
  loadJson,
  credential,
} from './config.js';
import { createWorker, retrySpool } from './worker.js';
import { reportWorkerDevices } from './device-reporting.js';
import { executeJob } from './executor.js';
import { runCommandProcess } from './processes.js';
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
  if (command === '--help' || command === '-h') {
    console.log(`Usage: fliwright-cloud-worker <command> <config.json>

Commands:
  run            Report host devices and execute queued tasks
  discover       Report host devices without an execution slot
  recover        Verify cleanup and recover an isolated slot
  retry-uploads  Retry retained report uploads without executing tests

Each Worker connects to the Cloud Server configured by serverUrl.
Credentials are read from the environment variable named by tokenEnv.`);
    return;
  }
  if (!path)
    throw new Error(
      'Usage: fliwright-cloud-worker <run|discover|recover|retry-uploads> <config.json>',
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
        const { commands, deviceId, directory } = loadJson(path) as {
          commands: Array<{
            program: string;
            args: string[];
            acceptExitCodes?: number[];
          }>;
          deviceId: string;
          directory: string;
        };
        for (const cmd of commands)
          await runCommandProcess(
            {
              ...cmd,
              args: cmd.args.map((a) => a.replaceAll('{deviceId}', deviceId)),
            },
            directory,
            join(directory, 'reset.log'),
            stop.signal,
          );
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
    await reportWorkerDevices(
      new CloudClient(config.serverUrl, credential(config.tokenEnv)),
      { signal: stop.signal, tools: config.deviceTools },
    );
    return;
  }
  if (['run', 'recover', 'retry-uploads'].includes(command)) {
    const config = workerConfigSchema.parse(loadJson(path)),
      worker = createWorker(config);
    if (command === 'recover') {
      await worker.recover();
      console.log('Device reset verified; slot recovered');
      return;
    }
    if (command === 'retry-uploads') {
      await retrySpool(config);
      console.log('Retained publications processed');
      return;
    }
    installStop();
    const inventory = reportWorkerDevices(
      new CloudClient(config.serverUrl, credential(config.tokenEnv)),
      { signal: stop.signal, tools: config.deviceTools },
    );
    try {
      while (!stop.signal.aborted) {
        await worker.runOnce(stop.signal);
        await delay(config.pollMs, undefined, { signal: stop.signal }).catch(
          () => {},
        );
      }
    } finally {
      stop.abort();
      await inventory;
    }
    return;
  }
  throw new Error('Unknown Worker command');
}
main().catch(() => {
  console.error(
    'Worker operation failed. Check configuration, credentials and local diagnostics; existing slot locks require recovery.',
  );
  process.exitCode = 1;
});
