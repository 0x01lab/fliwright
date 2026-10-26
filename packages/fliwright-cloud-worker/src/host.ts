import type { z } from 'zod';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CloudError, WorkerControlClient, idSchema, type ManagedDevice } from '@fliwright/cloud-protocol';
import { credential, hostConfigSchema, workerConfigSchema } from './config.js';
import { createWorker } from './worker.js';
import { reportWorkerDevices } from './device-reporting.js';
import { runCatalogScanner } from './catalog-scanner.js';
import { runCommandProcess } from './processes.js';

type HostConfig = z.infer<typeof hostConfigSchema>;

export function executorSettings(config: HostConfig, device: ManagedDevice, root: string): z.infer<typeof workerConfigSchema> {
  const slotId = idSchema.parse(device.settings.slotId);
  const xcrun = config.deviceTools?.xcrun ?? 'xcrun';
  const resetCommands = config.resetCommands ?? (
    device.observation.platform === 'ios' && device.observation.kind === 'simulator' ? [
      { program: xcrun, args: ['simctl', 'shutdown', '{deviceId}'], acceptExitCodes: [0, 149] },
      { program: xcrun, args: ['simctl', 'boot', '{deviceId}'] },
      { program: xcrun, args: ['simctl', 'bootstatus', '{deviceId}', '-b'] },
    ] : undefined);
  if (!resetCommands) throw new Error('Configure local resetCommands for this device platform');
  return workerConfigSchema.parse({ ...config, workerId: device.workerId, slotId, deviceId: device.nativeId,
    root: join(root, 'slots', slotId), resetCommands });
}

async function runExecutor(config: z.infer<typeof workerConfigSchema>, device: ManagedDevice, signal: AbortSignal) {
  const control = new WorkerControlClient(config.serverUrl, credential(config));
  try {
    const worker = createWorker(config, control);
    await control.ready(signal);
    // Enrollment may target a stopped simulator. Boot it without erasing user data.
    if (device.observation.platform === 'ios' && device.observation.kind === 'simulator' && device.observation.state === 'shutdown') {
      const program = config.deviceTools?.xcrun ?? 'xcrun';
      const bootSignal = AbortSignal.any([signal, AbortSignal.timeout(300000)]);
      for (const args of [['simctl', 'boot', config.deviceId], ['simctl', 'bootstatus', config.deviceId, '-b']])
        await runCommandProcess({ program, args }, config.root, join(config.root, 'prepare.log'), bootSignal);
    }
    while (!signal.aborted) {
      const revision = control.revision;
      let claimed = false;
      try { claimed = await worker.runOnce(signal); }
      catch (error) {
        if (signal.aborted) break;
        if (existsSync(join(config.root, 'slot.lock')) || error instanceof CloudError || control.connected) throw error;
      }
      if (!claimed) await control.waitForWork(revision, signal);
    }
  } finally { control.close(); }
}

/** One paired host follows device policy changes and owns isolated per-slot executors. */
export async function runHostWorker(config: HostConfig, configPath: string, signal: AbortSignal) {
  const root = resolve(config.root ?? join(dirname(configPath), 'runtime'));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stop = new AbortController();
  const runningSignal = AbortSignal.any([signal, stop.signal]);
  const control = new WorkerControlClient(config.serverUrl, credential(config));
  const executors = new Map<string, { signature: string; stop: AbortController; done: Promise<void> }>();
  const blocked = new Set<string>();
  let inventory: Promise<void> | undefined, scans: Promise<void> | undefined;
  try {
    await control.ready(runningSignal);
    inventory = reportWorkerDevices(control, { signal: runningSignal, tools: config.deviceTools });
    scans = runCatalogScanner(control, { root: join(root, 'catalogs'), signal: runningSignal, credentialHomes: config.repositoryCredentialHomes });
    while (!runningSignal.aborted) {
      const revision = control.revision;
      let assignments: { workerId: string; devices: ManagedDevice[] };
      try { assignments = await control.request('/api/worker/assignments', { signal: runningSignal }); }
      catch (error) {
        if (runningSignal.aborted || control.connected) throw error;
        await control.ready(runningSignal);
        continue;
      }
      const desired = new Map(assignments.devices.map(device => [idSchema.parse(device.settings.slotId), device]));
      for (const [slot, executor] of executors) {
        const device = desired.get(slot);
        if (!device || executor.signature !== device.nativeId) {
          executor.stop.abort();
          await executor.done;
          executors.delete(slot);
        }
      }
      for (const [slot, device] of desired) {
        if (executors.has(slot)) continue;
        try {
          const settings = executorSettings(config, device, root);
          mkdirSync(settings.root, { recursive: true, mode: 0o700 });
          writeFileSync(join(settings.root, 'worker.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
          const executorStop = new AbortController();
          const executorSignal = AbortSignal.any([runningSignal, executorStop.signal]);
          const done = runExecutor(settings, device, executorSignal).catch(() => {
            if (!executorSignal.aborted) console.warn(`Executor ${slot} stopped; check its local logs and recover quarantined slots explicitly.`);
          });
          executors.set(slot, { signature: device.nativeId, stop: executorStop, done });
          console.log(`Device ${device.observation.name} bound to slot ${slot}.`);
        } catch {
          if (!blocked.has(slot)) console.warn(`Device ${device.observation.name}: configure local resetCommands for this platform before execution.`);
          blocked.add(slot);
        }
      }
      await control.waitForWork(revision, runningSignal);
    }
  } catch (error) {
    if (!runningSignal.aborted) throw error;
  } finally {
    stop.abort();
    await Promise.allSettled([inventory, scans, ...[...executors.values()].map(executor => executor.done)]);
    control.close();
  }
}
