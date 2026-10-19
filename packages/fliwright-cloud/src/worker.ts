import {
  readdirSync,
  readFileSync,
  lstatSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { z } from 'zod';
import { CloudClient } from './CloudClient.js';
import { CloudError, type ExecutionLease, type Outcome } from './contracts.js';
import { credential, type workerConfigSchema } from './config.js';
import { digest } from './CloudStore.js';
import { WorkerAgent, writeJournal } from './WorkerAgent.js';
import {
  runCommandProcess,
  spawnExecution,
  stopOwnedProcesses,
  sanitizedEnvironment,
  createLogTail,
} from './processes.js';
import { safeArtifactPath } from './ReportStore.js';

type WorkerSettings = z.infer<typeof workerConfigSchema>;
export function createWorker(config: WorkerSettings) {
  if (process.platform === 'win32')
    throw new Error('Mac/Unix workers require owned process groups');
  const client = new CloudClient(config.serverUrl, credential(config.tokenEnv));
  let logAttempt: string | undefined;
  let readLogs: (() => string | undefined) | undefined;
  return new WorkerAgent(config, {
    claim: () =>
      client.request<ExecutionLease | null>('/api/worker/claim', {
        method: 'POST',
        body: { slotId: config.slotId },
      }),
    heartbeat: (lease, stage) => {
      if (logAttempt !== lease.attemptId) {
        logAttempt = lease.attemptId;
        readLogs = createLogTail(join(config.root, 'spool', lease.attemptId), [
          credential(config.tokenEnv),
        ]);
      }
      return client.request('/api/worker/heartbeat', {
        method: 'POST',
        body: { ...leaseKey(lease), stage, log: readLogs?.() },
      });
    },
    execute: (lease, directory, signal, onStage) =>
      spawnExecution(lease, directory, signal, onStage, {
        mainFile: fileURLToPath(new URL('./main.js', import.meta.url)),
        flutterBin: config.flutterBin,
        resetCommands: config.resetCommands,
        allowedEnv: config.allowedEnv.filter((k) => k !== config.tokenEnv),
      }),
    stopOwned: stopOwnedProcesses,
    reset: async () => {
      // Reset runs as its own recorded group too; a crashed reset cannot race recovery.
      const resetDir = join(config.root, 'reset');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(resetDir, { recursive: true, mode: 0o700 });
      await stopOwnedProcesses(resetDir);
      const { spawn } = await import('node:child_process');
      const { execFileSync } = await import('node:child_process');
      writeJournal(join(resetDir, 'job.json'), {
        commands: config.resetCommands,
        deviceId: config.deviceId,
        directory: resetDir,
      });
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL('./main.js', import.meta.url)),
          'reset',
          join(resetDir, 'job.json'),
        ],
        {
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: sanitizedEnvironment(
            config.allowedEnv.filter((k) => k !== config.tokenEnv),
          ),
        },
      );
      if (!child.pid) throw new Error('Reset process failed to launch');
      const complete = new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error('Device reset failed')),
        );
      });
      const start = execFileSync(
        'ps',
        ['-o', 'lstart=', '-p', String(child.pid)],
        { encoding: 'utf8' },
      ).trim();
      writeJournal(join(resetDir, 'process.json'), { pid: child.pid, start });
      child.send({ go: true });
      const timer = setTimeout(() => {
        void stopOwnedProcesses(resetDir).catch(() => {});
      }, 300000);
      try {
        await complete;
        await stopOwnedProcesses(resetDir);
      } finally {
        clearTimeout(timer);
      }
    },
    publish: (lease, directory) => publishBundle(client, lease, directory),
    recordResult: (lease, result) =>
      client.request('/api/worker/result', {
        method: 'POST',
        body: { ...leaseKey(lease), result },
      }),
    finish: (lease, outcome) =>
      client.request('/api/worker/finish', {
        method: 'POST',
        body: { ...leaseKey(lease), outcome },
      }),
    recover: async (evidence) => {
      await stopOwnedProcesses(join(config.root, 'reset'));
      return client.request('/api/worker/recover', {
        method: 'POST',
        body: { slotId: config.slotId, evidence },
      });
    },
  });
}
export const leaseKey = (lease: ExecutionLease) => ({
  workerId: lease.workerId,
  slotId: lease.slotId,
  attemptId: lease.attemptId,
  generation: lease.generation,
});
export async function publishBundle(
  client: CloudClient,
  lease: ExecutionLease,
  directory: string,
) {
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  const walk = (dir: string, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name,
        full = join(dir, entry.name);
      if (lstatSync(full).isSymbolicLink())
        throw new Error('Cannot upload symlinks');
      if (entry.isDirectory()) walk(full, path);
      else if (entry.isFile()) {
        safeArtifactPath(path);
        const bytes = readFileSync(full);
        files.push({ path, size: bytes.length, sha256: digest(bytes) });
      }
    }
  };
  walk(directory);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = JSON.parse(
    readFileSync(join(directory, 'run.json'), 'utf8'),
  ) as { runId: string };
  const journalPath = join(directory, '..', 'publication.json');
  let publication: { id: string; token: string };
  if (existsSync(journalPath))
    publication = JSON.parse(readFileSync(journalPath, 'utf8'));
  else {
    publication = await client.request('/api/worker/publications', {
      method: 'POST',
      body: {
        ...leaseKey(lease),
        publication: { runId: manifest.runId, files },
      },
    });
    writeJournal(journalPath, publication);
  }
  const signal = AbortSignal.timeout(120000);
  const retry = async (fn: () => Promise<unknown>) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (
          attempt >= 2 ||
          signal.aborted ||
          (e instanceof CloudError &&
            e.statusCode >= 400 &&
            e.statusCode < 500 &&
            e.statusCode !== 429)
        )
          throw e;
        await delay(500 * (attempt + 1), undefined, { signal });
      }
    }
  };
  for (const file of files)
    await retry(() =>
      client.request(
        `/api/publications/${publication.id}/file?path=${encodeURIComponent(file.path)}`,
        {
          method: 'PUT',
          body: readFileSync(join(directory, file.path)),
          publicationToken: publication.token,
          signal,
        },
      ),
    );
  await retry(() =>
    client.request(`/api/publications/${publication.id}/commit`, {
      method: 'POST',
      publicationToken: publication.token,
      signal,
    }),
  );
  return publication.id;
}
/** Retry retained upload capabilities without re-running a test or changing its verdict. */
export async function retrySpool(config: WorkerSettings) {
  const client = new CloudClient(config.serverUrl, credential(config.tokenEnv)),
    spool = join(config.root, 'spool');
  if (!existsSync(spool)) return;
  for (const entry of readdirSync(spool, { withFileTypes: true }))
    if (entry.isDirectory()) {
      const dir = join(spool, entry.name),
        jobPath = join(dir, 'job.json');
      if (!existsSync(jobPath) || !existsSync(join(dir, 'publication.json')))
        continue;
      const job = JSON.parse(readFileSync(jobPath, 'utf8')) as {
        lease: ExecutionLease;
      };
      try {
        await publishBundle(client, job.lease, join(dir, 'bundle'));
      } catch {
        continue;
      }
      const resultPath = join(dir, 'result.json');
      if (existsSync(resultPath))
        writeJournal(join(dir, 'upload-recovered.json'), {
          publishedAt: Date.now(),
        });
    }
}
