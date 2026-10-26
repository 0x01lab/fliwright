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
import {
  CloudClient,
  WorkerControlClient,
  CloudError,
  safeArtifactPath,
  type ExecutionLease,
  type Outcome,
} from '@fliwright/cloud-protocol';
import { credential, type workerConfigSchema } from './config.js';
import { createHash } from 'node:crypto';
import { WorkerAgent, writeJournal } from './WorkerAgent.js';
import type { WorkerTimelineChannel } from './WorkerTimelineChannel.js';
import { recordWorkerTimelineMessage } from './worker-timeline-ipc.js';
import {
  runCommandProcess,
  spawnExecution,
  stopOwnedProcesses,
  sanitizedEnvironment,
  createLogTail,
} from './processes.js';

const digest = (value: Buffer) =>
  createHash('sha256').update(value).digest('hex');

type WorkerSettings = z.infer<typeof workerConfigSchema>;
export function createWorker(config: WorkerSettings, control: WorkerControlClient) {
  if (process.platform === 'win32')
    throw new Error('Mac/Unix workers require owned process groups');
  const client = new CloudClient(config.serverUrl, credential(config));
  let logAttempt: string | undefined;
  let readLogs: (() => string | undefined) | undefined;
  return new WorkerAgent(config, {
    claim: (signal) =>
      control.request<ExecutionLease | null>('/api/worker/claim', {
        method: 'POST',
        body: { slotId: config.slotId, deviceId: config.deviceId },
        signal,
      }),
    watchLease: (lease, listener) => control.watchLease(lease, listener),
    heartbeat: (lease, stage, timelineClock) => {
      if (logAttempt !== lease.attemptId) {
        logAttempt = lease.attemptId;
        readLogs = createLogTail(join(config.root, 'spool', lease.attemptId), [
          credential(config),
        ]);
      }
      return control.request('/api/worker/heartbeat', {
        method: 'POST',
        body: { ...leaseKey(lease), stage, log: readLogs?.(), timelineClock },
      });
    },
    recordTimeline: (batch, signal) => control.request('/api/worker/timeline', { method: 'POST', body: batch, signal }),
    execute: (lease, directory, signal, onStage, timeline) =>
      spawnExecution(lease, directory, signal, onStage, {
        mainFile: fileURLToPath(new URL('./main.js', import.meta.url)),
        flutterBin: config.flutterBin,
        resetCommands: config.resetCommands,
        allowedEnv: config.allowedEnv.filter((k) => k !== config.tokenEnv),
        timeline,
      }),
    stopOwned: stopOwnedProcesses,
    reset: async (timeline, parentSpanId) => {
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
        parentSpanId,
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
      child.on('message', message => recordWorkerTimelineMessage(child, message, timeline, 'reset'));
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
      } finally {
        clearTimeout(timer);
        await stopOwnedProcesses(resetDir);
        timeline?.interrupt('reset', 'process_exit');
      }
    },
    publish: (lease, directory, timeline, parentSpanId) => publishBundle(client, lease, directory, timeline, parentSpanId),
    recordResult: (lease, result) =>
      control.request('/api/worker/result', {
        method: 'POST',
        body: { ...leaseKey(lease), result },
      }),
    finish: (lease, outcome, timeline) =>
      control.request('/api/worker/finish', {
        method: 'POST',
        body: { ...leaseKey(lease), outcome, timeline },
      }),
    recover: async (evidence) => {
      await stopOwnedProcesses(join(config.root, 'reset'));
      return control.request('/api/worker/recover', {
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
  timeline?: WorkerTimelineChannel,
  parentSpanId?: string,
) {
  const prepare = async () => {
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
  return { publication, files };
  };
  const { publication, files } = timeline
    ? await timeline.run('report.publish', prepare, { parentSpanId, operation: 'publication.prepare' })
    : await prepare();
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
  const commit = () => retry(() =>
    client.request(`/api/publications/${publication.id}/commit`, {
      method: 'POST',
      publicationToken: publication.token,
      signal,
    }),
  );
  if (timeline) await timeline.run('report.publish', commit, { parentSpanId, operation: 'publication.commit' });
  else await commit();
  return publication.id;
}
/** Retry retained upload capabilities without re-running a test or changing its verdict. */
export async function retrySpool(config: WorkerSettings) {
  const client = new CloudClient(config.serverUrl, credential(config)),
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
