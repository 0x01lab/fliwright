import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
} from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeJournal } from './WorkerAgent.js';
import type { ExecutionLease } from './contracts.js';

/** Bounded, incremental diagnostics; never read an entire build log into memory. */
export function createLogTail(directory: string, secrets: string[] = []) {
  const offsets = new Map<string, number>();
  return (): string | undefined => {
    let output = '';
    for (const name of ['commands.log', 'executor.log']) {
      let fd: number | undefined;
      try {
        fd = openSync(join(directory, name), 'r');
        const size = fstatSync(fd).size;
        const previous = offsets.get(name) ?? 0;
        const start = Math.max(previous <= size ? previous : 0, size - 1500);
        offsets.set(name, size);
        if (size === start) continue;
        const bytes = Buffer.alloc(size - start);
        const count = readSync(fd, bytes, 0, bytes.length, start);
        output += `[${name}]\n${bytes.subarray(0, count).toString('utf8')}\n`;
      } catch {
        // Logs may not exist yet or may be removed after completion.
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
    if (!output) return undefined;
    return secrets
      .reduce(
        (value, secret) =>
          secret ? value.split(secret).join('[redacted]') : value,
        output,
      )
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/(?:wss?|https?):\/\/[^\s"']+/g, '[endpoint]')
      .slice(-3000);
  };
}

function startIdentity(pid: number) {
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}
function groupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw e;
  }
}
const stopping = new Map<string, Promise<void>>();
/** Refuse ambiguous PID reuse instead of terminating unrelated processes. */
export function stopOwnedProcesses(directory: string): Promise<void> {
  const current = stopping.get(directory);
  if (current) return current;
  const pending = stopGroup(directory).finally(() =>
    stopping.delete(directory),
  );
  stopping.set(directory, pending);
  return pending;
}
async function stopGroup(directory: string) {
  const path = join(directory, 'process.json');
  if (!existsSync(path)) return;
  const owned = JSON.parse(readFileSync(path, 'utf8')) as {
    pid: number;
    start: string;
  };
  if (!Number.isSafeInteger(owned.pid) || owned.pid <= 1)
    throw new Error('Invalid owned process identity');
  if (!groupExists(owned.pid)) return;
  const actual = startIdentity(owned.pid);
  if (!actual || !owned.start || actual !== owned.start)
    throw new Error(
      'Ambiguous owned process group; inspect locally before recovery',
    );
  // Give the executor a chance to abort its runner and export partial evidence.
  // The supervisor still owns every descendant and force-reaps the entire group.
  process.kill(owned.pid, 'SIGTERM');
  for (let i = 0; i < 150; i++) {
    if (!groupExists(owned.pid)) return;
    try {
      process.kill(owned.pid, 0);
    } catch {
      break;
    }
    await delay(100);
  }
  process.kill(-owned.pid, 'SIGKILL');
  for (let i = 0; i < 30; i++) {
    if (!groupExists(owned.pid)) return;
    await delay(100);
  }
  throw new Error('Owned process group did not terminate');
}
export function sanitizedEnvironment(extraKeys: string[] = []) {
  const keys = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'LANG',
    'LC_ALL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SHELL',
    'DEVELOPER_DIR',
    'ANDROID_HOME',
    'ANDROID_SDK_ROOT',
    'JAVA_HOME',
    'PUB_CACHE',
    'SSH_AUTH_SOCK',
    ...extraKeys,
  ];
  return Object.fromEntries(
    keys
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
}
export async function runCommandProcess(
  command: { program: string; args: string[]; acceptExitCodes?: number[] },
  cwd: string,
  logFile: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command.program, command.args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    const abort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + String(chunk)).slice(-1024 * 1024);
      appendFileSync(logFile, chunk, { mode: 0o600 });
    });
    child.stderr.on('data', (chunk) =>
      appendFileSync(logFile, chunk, { mode: 0o600 }),
    );
    child.on('error', (e) => {
      signal?.removeEventListener('abort', abort);
      reject(e);
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('Command aborted'));
      else if ((command.acceptExitCodes ?? [0]).includes(code ?? -1))
        resolve(stdout.trim());
      else
        reject(
          new Error(
            `Registered command failed (${command.program}, exit ${code}); inspect local diagnostics`,
          ),
        );
    });
  });
}
export async function spawnExecution(
  lease: ExecutionLease,
  directory: string,
  signal: AbortSignal,
  onStage: (stage: string) => void,
  options: {
    mainFile: string;
    flutterBin: string;
    resetCommands: Array<{
      program: string;
      args: string[];
      acceptExitCodes?: number[];
    }>;
    allowedEnv?: string[];
  },
) {
  signal.throwIfAborted();
  const jobPath = join(directory, 'job.json');
  writeJournal(jobPath, {
    lease,
    directory,
    flutterBin: options.flutterBin,
    resetCommands: options.resetCommands,
  });
  let child: ChildProcess | undefined;
  return new Promise<import('./WorkerAgent.js').ExecutionResult>(
    (resolve, reject) => {
      child = spawn(process.execPath, [options.mainFile, 'execute', jobPath], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: sanitizedEnvironment(options.allowedEnv),
      });
      const abort = () => {
        void stopOwnedProcesses(directory).catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
      child.stdout?.on('data', (chunk) =>
        appendFileSync(join(directory, 'executor.log'), chunk, { mode: 0o600 }),
      );
      child.stderr?.on('data', (chunk) =>
        appendFileSync(join(directory, 'executor.log'), chunk, { mode: 0o600 }),
      );
      child.on('message', (message) => {
        if (message && typeof message === 'object') {
          if ('stage' in message && typeof message.stage === 'string')
            onStage(message.stage);
          if ('done' in message && message.done === true)
            try {
              resolve(
                JSON.parse(
                  readFileSync(join(directory, 'result.json'), 'utf8'),
                ),
              );
            } catch {
              reject(new Error('Missing executor result'));
            }
        }
      });
      child.on('error', (e) => {
        signal.removeEventListener('abort', abort);
        reject(e);
      });
      child.on('close', () => {
        signal.removeEventListener('abort', abort);
        try {
          resolve(
            JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8')),
          );
        } catch {
          reject(new Error('Executor ended without a durable result'));
        }
      });
      if (!child.pid) {
        reject(new Error('Failed to create executor'));
        return;
      }
      // The executor waits for go; it cannot touch devices before ownership is durable.
      const start = startIdentity(child.pid);
      writeJournal(join(directory, 'process.json'), { pid: child.pid, start });
      child.send({ go: true });
      if (signal.aborted) abort();
    },
  );
}
