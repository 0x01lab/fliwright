import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { StringDecoder } from 'node:string_decoder';

export class FlutterBuildError extends Error {
  constructor(readonly code: string, message: string, readonly cleanupConfirmed = true) {
    super(message); this.name = 'FlutterBuildError';
  }
}

/** One Unix process group per command; no raw argv or tool output escapes in errors. */
export async function runFlutterBuildCommand(program: string, args: string[], options: {
  cwd: string; signal: AbortSignal; deadline: number; cleanupTimeoutMs: number;
  recordProcess(pid: number): void;
}): Promise<string> {
  if (process.platform === 'win32') throw new FlutterBuildError('BUILD_PRECONDITION', 'Owned Android builds require Unix process-group supervision.');
  checkBuildDeadline(options);
  const child = spawn(program, args, { cwd: options.cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    // Prevent a reusable Gradle daemon from escaping the build's cleanup lifetime.
    env: { ...process.env, GRADLE_OPTS: `${process.env.GRADLE_OPTS ?? ''} -Dorg.gradle.daemon=false` },
  });
  let exited = false, closed = false, failure: FlutterBuildError | undefined, output = '', bytes = 0;
  const decoder = new StringDecoder('utf8');
  let complete!: () => void;
  const done = new Promise<void>(resolve => { complete = resolve; });
  const fail = (error: FlutterBuildError) => { failure ??= error; complete(); };
  child.once('error', () => { exited = true; fail(new FlutterBuildError('BUILD_FAILED', 'Flutter build tool is not installed or executable.')); });
  child.once('exit', code => {
    exited = true;
    if (code !== 0) failure ??= new FlutterBuildError('BUILD_FAILED', 'Flutter build command failed.');
    complete();
  });
  child.once('close', () => { output += decoder.end(); closed = true; });
  const consume = (chunk: Buffer, stdout: boolean) => {
    bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) { fail(new FlutterBuildError('BUILD_OUTPUT_LIMIT', 'Flutter build exceeded its output limit.')); return; }
    if (stdout) output += decoder.write(chunk);
  };
  child.stdout.on('data', chunk => consume(chunk, true));
  child.stderr.on('data', chunk => consume(chunk, false));
  const abort = () => fail(new FlutterBuildError('BUILD_CANCELLED', 'Flutter Android build was cancelled.'));
  options.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => fail(new FlutterBuildError('BUILD_TIMEOUT', 'Flutter Android build exceeded its deadline.')), Math.max(1, options.deadline - Date.now()));
  try {
    try {
      if (child.pid) options.recordProcess(child.pid);
      if (options.signal.aborted) abort();
      await done;
    } catch { failure ??= new FlutterBuildError('BUILD_FAILED', 'Could not record owned Flutter build process.'); }
    // A successful leader exit alone does not prove that Gradle/descendants exited.
    const deadline = Date.now() + options.cleanupTimeoutMs;
    const exists = () => {
      if (!child.pid) return false;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
    };
    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    };
    try {
      if (exists()) terminate('SIGTERM');
      const forceAt = Date.now() + Math.min(1000, options.cleanupTimeoutMs / 2);
      let forced = false;
      while (!exited || !closed || exists()) {
        if (Date.now() >= deadline) throw new Error('unconfirmed');
        if (!forced && Date.now() >= forceAt) { terminate('SIGKILL'); forced = true; }
        await delay(10);
      }
    } catch {
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      throw new FlutterBuildError('BUILD_CLEANUP_UNCONFIRMED', 'Owned Flutter build process-group cleanup is unconfirmed; build ownership was retained.', false);
    }
    if (failure) throw failure;
    checkBuildDeadline(options);
    return output;
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', abort);
  }
}

export function checkBuildDeadline(options: { signal: AbortSignal; deadline: number }): void {
  if (options.signal.aborted) throw new FlutterBuildError('BUILD_CANCELLED', 'Flutter Android build was cancelled.');
  if (Date.now() >= options.deadline) throw new FlutterBuildError('BUILD_TIMEOUT', 'Flutter Android build exceeded its deadline.');
}
