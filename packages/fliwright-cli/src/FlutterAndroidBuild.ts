import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, createReadStream, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkBuildDeadline, FlutterBuildError, runFlutterBuildCommand } from './FlutterBuildProcess.js';

export interface FlutterAndroidBuildOptions {
  projectRoot: string;
  target?: string;
  flutterBin?: string;
  flutterArgs?: readonly string[];
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  signal?: AbortSignal;
}

export interface FlutterAndroidApk {
  apkPath: string;
  sha256: string;
  bytes: number;
  projectDirectory: string;
  target: string;
  flavor?: string;
}

/** Build without installing; the immutable staged APK exists only during consumption. */
export async function withFlutterAndroidApk<T>(options: FlutterAndroidBuildOptions, consume: (apk: FlutterAndroidApk) => Promise<T>): Promise<T> {
  const budget = positive(options.timeoutMs ?? 600000), cleanupTimeoutMs = positive(options.cleanupTimeoutMs ?? 5000);
  if (typeof options.projectRoot !== 'string' || !options.projectRoot || options.projectRoot.includes('\0')
    || (options.target !== undefined && (typeof options.target !== 'string' || !options.target || options.target.includes('\0')))
    || (options.flutterBin !== undefined && (typeof options.flutterBin !== 'string' || !options.flutterBin || options.flutterBin.includes('\0')))) throw invalid('Invalid Flutter Android build input.');
  const context = { signal: options.signal ?? new AbortController().signal, deadline: Date.now() + budget };
  checkBuildDeadline(context);
  const args = validateArguments(options.flutterArgs ?? []);
  const location = await resolveFlutterBuildLocation(options.projectRoot, options.target ?? 'lib/main.dart');
  const lock = await acquireBuildLock(location.directory, context);
  let staged: string | undefined, released = false, cleanupConfirmed = true;
  const run = (command: string[]) => runFlutterBuildCommand(options.flutterBin ?? 'flutter', command, {
    ...context, cwd: location.directory, cleanupTimeoutMs, recordProcess: lock.recordProcess,
  });
  try {
    let config: Record<string, unknown>;
    try { config = JSON.parse(await run(['config', '--machine'])); }
    catch (error) {
      if (error instanceof FlutterBuildError) throw error;
      throw invalid('Flutter config did not return a machine-readable configuration.');
    }
    if (!config || Array.isArray(config) || typeof config !== 'object') throw invalid('Flutter config did not return a machine-readable configuration.');
    const buildDir = config['build-dir'] ?? 'build';
    if (typeof buildDir !== 'string' || !buildDir || buildDir.includes('\0') || isAbsolute(buildDir)
      || !inside(location.directory, resolve(location.directory, buildDir))) throw invalid('Flutter build directory must stay inside its app package.');
    const outputDirectory = join(location.directory, buildDir, 'app/outputs/flutter-apk');
    await assertContainedPath(location.directory, outputDirectory);
    const before = await apkCandidates(outputDirectory, args.flavor);
    await run(['build', 'apk', '--debug', `--target=${location.target}`, ...args.values]);
    checkBuildDeadline(context);
    await assertContainedPath(location.directory, outputDirectory);
    const candidates = await apkCandidates(outputDirectory, args.flavor);
    const fresh = [...candidates].filter(([name, after]) => {
      const previous = before.get(name);
      return !previous || previous.ino !== after.ino || previous.mtimeNs !== after.mtimeNs || previous.ctimeNs !== after.ctimeNs || previous.size !== after.size;
    });
    if (fresh.length !== 1) throw invalid('Flutter build must produce a single fresh APK.');
    const [name, after] = fresh[0], output = join(outputDirectory, name);
    const flavor = args.flavor ?? /^app-(.+)-debug\.apk$/.exec(name)?.[1];
    staged = await mkdtemp(join(tmpdir(), 'fliwright-android-build-'));
    const apkPath = join(staged, 'app.apk');
    const input = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const current = await input.stat({ bigint: true });
      if (!current.isFile() || current.ino !== after.ino || current.dev !== after.dev || current.mtimeNs !== after.mtimeNs || current.size !== after.size) throw invalid('Flutter APK changed before staging.');
      const destination = await open(apkPath, 'wx', 0o600);
      try {
        const bytes = Buffer.alloc(1024 * 1024); let position = 0;
        while (true) {
          checkBuildDeadline(context);
          const read = await input.read(bytes, 0, bytes.length, position);
          if (!read.bytesRead) break;
          position += read.bytesRead;
          if (position > 512 * 1024 * 1024) throw invalid('Flutter APK exceeds 512 MiB.');
          await destination.writeFile(bytes.subarray(0, read.bytesRead));
        }
        await destination.sync();
      } finally { await destination.close(); }
      const final = await input.stat({ bigint: true });
      if (final.size !== after.size || final.mtimeNs !== after.mtimeNs || final.ctimeNs !== after.ctimeNs) throw invalid('Flutter APK changed during staging.');
    } finally { await input.close(); }
    await chmod(apkPath, 0o600);
    const sha256 = createHash('sha256');
    for await (const chunk of createReadStream(apkPath, { signal: context.signal })) { checkBuildDeadline(context); sha256.update(chunk); }
    checkBuildDeadline(context);
    // Installation consumes the private copy, so another build may now use the package.
    await lock.release(); released = true;
    return await consume({ apkPath, sha256: sha256.digest('hex'), bytes: Number(after.size), projectDirectory: location.directory,
      target: location.target, ...(flavor ? { flavor } : {}) });
  } catch (error) {
    if (error instanceof FlutterBuildError && !error.cleanupConfirmed && !released) {
      cleanupConfirmed = false;
      try { lock.retain(); }
      catch (checkpoint) { throw new AggregateError([error, checkpoint], 'Flutter build cleanup and recovery checkpoint failed; build ownership was retained.'); }
    }
    throw error;
  } finally {
    try { if (staged) await rm(staged, { recursive: true, force: true }); }
    finally { if (!released && cleanupConfirmed) await lock.release(); }
  }
}

function positive(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 3600000) throw invalid('Flutter build budgets must be positive and at most one hour.');
  return value;
}
function invalid(message: string): FlutterBuildError { return new FlutterBuildError('BUILD_PRECONDITION', message); }
function inside(root: string, path: string): boolean {
  const value = relative(root, path); return value !== '' && !isAbsolute(value) && value !== '..' && !value.startsWith('../');
}

async function resolveFlutterBuildLocation(project: string, entry: string) {
  const root = await realpath(project), target = await realpath(resolve(project, entry));
  if (!inside(root, target)) throw invalid('Flutter entry escapes the configured project.');
  if (!target.endsWith('.dart') || !(await stat(target)).isFile()) throw invalid('Flutter entry must be a Dart file.');
  let directory = dirname(target);
  while (true) {
    const manifest = await stat(join(directory, 'pubspec.yaml')).catch(() => undefined);
    if (manifest?.isFile()) {
      if (!(await stat(join(directory, 'android')).catch(() => undefined))?.isDirectory()) throw invalid('Flutter app has no generated Android host.');
      return { directory, target: relative(directory, target) };
    }
    if (directory === root) break;
    directory = dirname(directory);
  }
  throw invalid('Flutter entry has no app package inside the configured project.');
}

function validateArguments(input: readonly string[]): { values: string[]; flavor?: string } {
  if (!Array.isArray(input) || input.length > 64 || input.some(value => typeof value !== 'string' || value.includes('\0'))
    || Buffer.byteLength(input.join('')) > 65536) throw invalid('Invalid Flutter Android build arguments.');
  const values: string[] = []; let flavor: string | undefined;
  for (let index = 0; index < input.length; index++) {
    const arg = input[index];
    const key = arg.split('=')[0];
    if (['--flavor', '--dart-define', '--target-platform', '--build-name', '--build-number'].includes(key)) {
      const value = arg.includes('=') ? arg.slice(key.length + 1) : input[++index];
      if (!value || value.startsWith('-')) throw invalid('Invalid Flutter Android build arguments.');
      if (key === '--flavor') {
        if (flavor || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw invalid('Invalid Flutter Android build arguments.');
        flavor = value;
      }
      if (key === '--target-platform' && !/^(android-arm|android-arm64|android-x64)(,(android-arm|android-arm64|android-x64))*$/.test(value)) throw invalid('Invalid Flutter Android build arguments.');
      values.push(`${key}=${value}`);
    } else if (['--no-pub', '--pub', '--track-widget-creation', '--no-track-widget-creation', '--ignore-deprecation'].includes(arg)) values.push(arg);
    else throw invalid('Unsupported Flutter Android build arguments; provide only build-time flavor, defines, architecture or version settings.');
  }
  return { values, flavor };
}

async function assertContainedPath(root: string, path: string): Promise<void> {
  let current = path;
  while (current !== root) {
    const value = await lstat(current).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (value?.isSymbolicLink()) throw invalid('Flutter build directory and APK cannot contain symlinks.');
    if (value && !inside(root, await realpath(current))) throw invalid('Flutter build directory escapes its package.');
    current = dirname(current);
  }
}

async function regularApk(path: string) {
  const value = await lstat(path, { bigint: true }).catch(error => {
    throw invalid('Flutter build did not produce the expected single APK.');
  });
  if (!value.isFile() || value.size <= 0n || value.size > 512n * 1024n * 1024n) throw invalid('Flutter APK must be a regular file no larger than 512 MiB.');
  return value;
}

async function apkCandidates(directory: string, flavor?: string): Promise<Map<string, BigIntStats>> {
  const files = await readdir(directory).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  if (files.length > 256) throw invalid('Flutter APK output directory exceeds its file limit.');
  const result = new Map<string, BigIntStats>();
  for (const name of files) {
    if (flavor ? name !== `app-${flavor.toLowerCase()}-debug.apk` : !/^app(?:-[a-z][a-z0-9_]*)?-debug\.apk$/.test(name)) continue;
    result.set(name, await regularApk(join(directory, name)));
  }
  return result;
}

/** Host-wide lock across callers/config roots; stale or uncertain owners require recovery. */
async function acquireBuildLock(directory: string, context: { signal: AbortSignal; deadline: number }) {
  const key = createHash('sha256').update(directory).digest('hex');
  const parent = join(homedir(), '.fliwright', 'android-build-locks'), path = join(parent, key + '.lock');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const record = { token: randomUUID(), ownerPid: process.pid, childPid: undefined as number | undefined, cleanupUnconfirmed: false };
  while (true) {
    checkBuildDeadline(context);
    try { await mkdir(path, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = await readFile(join(path, 'owner.json'), 'utf8').then(JSON.parse, () => undefined);
      if (!owner) {
        const entry = await lstat(path).catch(() => undefined);
        if (entry && Date.now() - entry.mtimeMs > 2000) throw invalid('Android build ownership is unconfirmed; inspect the retained build lock before recovery.');
        await delay(25, undefined, { signal: context.signal }).catch(() => checkBuildDeadline(context));
        continue;
      }
      if (owner.cleanupUnconfirmed) throw invalid('Android build cleanup is unconfirmed; inspect its recorded process group before recovery.');
      if (!Number.isSafeInteger(owner.ownerPid) || owner.ownerPid <= 1) throw invalid('Android build ownership is unconfirmed; inspect the retained build lock before recovery.');
      try { process.kill(owner.ownerPid, 0); }
      catch { throw invalid('A previous Android build owner exited; confirm its recorded process group stopped before explicit recovery.'); }
      await delay(25, undefined, { signal: context.signal }).catch(() => checkBuildDeadline(context));
    }
  }
  const checkpoint = () => {
    const temporary = join(path, record.token + '.tmp');
    const fd = openSync(temporary, 'w', 0o600);
    try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, join(path, 'owner.json'));
    const directory = openSync(path, 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  };
  try { checkpoint(); }
  catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
  return {
    recordProcess(pid: number) { record.childPid = pid; checkpoint(); },
    retain() { record.cleanupUnconfirmed = true; checkpoint(); },
    async release() {
      const owner = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8'));
      if (owner.token !== record.token) throw new FlutterBuildError('BUILD_CLEANUP_UNCONFIRMED', 'Android build ownership changed; its lock was retained.', false);
      await rm(path, { recursive: true, force: true });
    },
  };
}
