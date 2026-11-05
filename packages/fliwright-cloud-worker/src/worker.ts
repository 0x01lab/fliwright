import {
  readdirSync,
  readFileSync,
  lstatSync,
  existsSync,
  rmSync,
  openSync,
  closeSync,
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
import type { WorkerDiagnostics } from './diagnostics.js';
import { WorkerNativeOwnership } from './WorkerNativeOwnership.js';
import { ManagedNativeTimeline } from './ManagedNativeTimeline.js';
import { compactSpoolAttempt, pruneSpool } from './spool.js';
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
export function createWorker(config: WorkerSettings, control: WorkerControlClient, diagnostics?: WorkerDiagnostics) {
  if (process.platform === 'win32')
    throw new Error('Mac/Unix workers require owned process groups');
  const client = new CloudClient(config.serverUrl, credential(config));
  let logAttempt: string | undefined;
  let readLogs: (() => string | undefined) | undefined;
  const nativeOwnership = new WorkerNativeOwnership();
  return new WorkerAgent(config, {
    claim: (signal) =>
      control.request<ExecutionLease | null>('/api/worker/claim', {
        method: 'POST',
        body: { slotId: config.slotId, deviceId: config.deviceId },
        signal,
      }),
    watchLease: (lease, listener) => control.watchLease(lease, listener),
    heartbeat: async (lease, stage, timelineClock) => {
      if (logAttempt !== lease.attemptId) {
        logAttempt = lease.attemptId;
        readLogs = createLogTail(join(config.root, 'spool', lease.attemptId), [
          credential(config),
        ]);
      }
      try { return await control.request('/api/worker/heartbeat', {
        method: 'POST',
        body: { ...leaseKey(lease), stage, log: readLogs?.(), timelineClock },
      }); } catch (error) {
        diagnostics?.record('error', 'lease.heartbeat_failed', error, { slotId: lease.slotId, requestId: lease.request.id, attemptId: lease.attemptId });
        throw error;
      }
    },
    recordTimeline: (batch, signal) => control.request('/api/worker/timeline', { method: 'POST', body: batch, signal }),
    execute: async (lease, directory, signal, onStage, timeline) => {
      const context = { slotId: lease.slotId, requestId: lease.request.id, attemptId: lease.attemptId };
      const nativeTimeline = new ManagedNativeTimeline(timeline?.channel);
      diagnostics?.record('info', 'execution.started', 'Execution child starting', context);
      try {
      const result = await spawnExecution(lease, directory, signal, onStage, {
        mainFile: fileURLToPath(new URL('./main.js', import.meta.url)),
        flutterBin: config.flutterBin,
        resetCommands: config.resetCommands,
        allowedEnv: config.allowedEnv.filter((k) => k !== config.tokenEnv),
        timeline,
        prepareNative: async project => {
          const grant = await nativeOwnership.acquire(project, { deviceId: lease.deviceId, signal, scenario: lease.request.input.scenario ?? null,
          onPhase: event => nativeTimeline.observe(event),
          launch: { target: lease.request.target.entry, flutterArgs: lease.request.target.flutterArgs, requiredCapabilities: lease.request.target.requiredCapabilities, flutterBin: config.flutterBin } });
          await nativeTimeline.flush();
          return grant;
        },
        prepareNativeAttempt: async (project, request, attemptSignal) => {
          await nativeOwnership.prepareAttempt(project, request, attemptSignal);
          await nativeTimeline.flush();
        },
      });
      await nativeTimeline.flush();
      diagnostics?.record(result.infrastructure ? 'error' : 'info', 'execution.finished', result.error ?? `Execution verdict: ${result.verdict}`, context);
      return result;
      } catch (error) { diagnostics?.record('error', 'execution.child_failed', error, context); throw error; }
      finally { await nativeTimeline.flush(); }
    },
    stopOwned: stopOwnedProcesses,
    reset: async (timeline, parentSpanId) => {
      await nativeOwnership.reset(async () => {
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
      });
      await new Promise(resolve => setTimeout(resolve, 0));
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
  const lock = join(config.root, 'slot.lock');
  try { closeSync(openSync(lock, 'wx', 0o600)); }
  catch { throw new Error('Worker slot lock exists; stop execution and complete recovery before retrying uploads'); }
  try {
  writeJournal(lock, { pid: process.pid, stage: 'retry-uploads' });
  await pruneSpool(config.root, config.spoolRetention, stopOwnedProcesses);
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
      const retentionPath = join(dir, 'retention.json');
      const completedAt = existsSync(retentionPath)
        ? (JSON.parse(readFileSync(retentionPath, 'utf8')) as { completedAt: number }).completedAt
        : lstatSync(existsSync(resultPath) ? resultPath : jobPath).mtimeMs;
      writeJournal(retentionPath, { completedAt, published: true, bundleReady: true });
      await compactSpoolAttempt(dir, true, true);
    }
  await pruneSpool(config.root, config.spoolRetention, stopOwnedProcesses);
  } finally { rmSync(lock, { force: true }); }
}
