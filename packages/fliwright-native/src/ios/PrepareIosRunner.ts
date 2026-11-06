import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeError, type NativeOperationContext } from '@fliwright/core';
import { DeviceLeaseManager } from '../DeviceLease.js';
import { executeTool, type ToolExecutor } from '../ToolExecutor.js';
import { runnerProtocolVersion } from './RunnerBroker.js';

export interface PrepareIosRunnerOptions {
  cacheRoot?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  tools?: { xcodebuild?: string; xcrun?: string };
  /** Internal build-contract test seams. */
  sourceRoot?: string;
  executor?: ToolExecutor;
}
export interface PreparedIosRunner {
  xctestrunPath: string;
  cacheKey: string;
  cached: boolean;
  xcode: string;
  sdkBuild: string;
}

/** Explicit, device-independent Simulator build. Importing the package never builds. */
export async function prepareIosRunner(options: PrepareIosRunnerOptions = {}): Promise<PreparedIosRunner> {
  const timeout = options.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new NativeError('precondition_failed', 'Runner build timeout must be a positive integer.');
  if (options.signal?.aborted) throw new NativeError('cancelled', 'Runner preparation cancelled.');
  if (process.platform !== 'darwin' && !options.executor) throw new NativeError('unsupported_capability', 'Preparing XCTest requires macOS and Xcode.');
  const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]);
  const context: NativeOperationContext = { requestId: randomUUID(), deadline: Date.now() + timeout, signal };
  const run = options.executor ?? executeTool;
  const xcodebuild = options.tools?.xcodebuild ?? 'xcodebuild', xcrun = options.tools?.xcrun ?? 'xcrun';
  const sourceRoot = resolve(options.sourceRoot ?? join(dirname(fileURLToPath(import.meta.url)), '../../runners/ios'));
  const files = ['FliwrightRunner.swift', 'RunnerRecoveryControl.swift', 'FliwrightRunner.xcodeproj/project.pbxproj',
    'FliwrightRunner.xcodeproj/xcshareddata/xcschemes/FliwrightRunner.xcscheme'];
  const sources = await Promise.all(files.map(async file => ({ file, contents: await readFile(join(sourceRoot, file), 'utf8') })));
  const xcode = (await run(xcodebuild, ['-version'], context)).toString('utf8').trim();
  const sdkBuild = (await run(xcrun, ['--sdk', 'iphonesimulator', '--show-sdk-build-version'], context)).toString('utf8').trim();
  if (!xcode || !sdkBuild) throw new NativeError('runner_unavailable', 'Xcode and Simulator SDK build versions are required for Runner preparation.');
  const cacheKey = createHash('sha256').update(JSON.stringify({ sources, protocolVersion: runnerProtocolVersion, xcode, sdkBuild,
    architecture: process.arch, signing: 'simulator-unsigned', configuration: 'Debug' })).digest('hex');
  const cacheRoot = resolve(options.cacheRoot ?? join(homedir(), '.fliwright', 'native', 'ios-runners'));
  const productRoot = join(cacheRoot, cacheKey);
  const lease = await new DeviceLeaseManager({ rootDir: join(cacheRoot, '.build-locks') }).acquire('ios', cacheKey, { signal });
  try {
    const cachedProduct = await readProduct(productRoot);
    if (cachedProduct) return { xctestrunPath: cachedProduct, cacheKey, cached: true, xcode, sdkBuild };
    signal.throwIfAborted();
    await mkdir(productRoot, { recursive: true, mode: 0o700 });
    await run(xcodebuild, ['-project', join(sourceRoot, 'FliwrightRunner.xcodeproj'), '-scheme', 'FliwrightRunner',
      '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-configuration', 'Debug',
      '-derivedDataPath', productRoot, 'build-for-testing', 'CODE_SIGNING_ALLOWED=NO', '-quiet'], context);
    signal.throwIfAborted();
    const products = await readdir(join(productRoot, 'Build/Products'));
    const candidates = products.filter(file => file.startsWith('FliwrightRunner_') && file.endsWith('.xctestrun'));
    if (candidates.length !== 1) throw new NativeError('runner_unavailable', 'Runner build did not produce exactly one Simulator .xctestrun product.');
    if (!await hasExecutables(productRoot)) throw new NativeError('runner_unavailable', 'Runner build is missing its host or test executable.');
    const temporary = join(productRoot, `prepared-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ version: 1, product: candidates[0] }), { mode: 0o600 });
    await rename(temporary, join(productRoot, 'prepared.json'));
    return { xctestrunPath: join(productRoot, 'Build/Products', candidates[0]), cacheKey, cached: false, xcode, sdkBuild };
  } finally { await lease.release(); }
}

async function readProduct(productRoot: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(productRoot, 'prepared.json'), 'utf8')) as { version?: unknown; product?: unknown };
    if (manifest.version !== 1 || typeof manifest.product !== 'string' || !/^FliwrightRunner_[A-Za-z0-9_.-]+\.xctestrun$/.test(manifest.product)) return;
    const path = join(productRoot, 'Build/Products', manifest.product);
    if ((await stat(path)).isFile() && await hasExecutables(productRoot)) return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
}

async function hasExecutables(productRoot: string): Promise<boolean> {
  const runner = join(productRoot, 'Build/Products/Debug-iphonesimulator/FliwrightRunner-Runner.app');
  const binaries = ['FliwrightRunner-Runner', 'PlugIns/FliwrightRunner.xctest/FliwrightRunner'];
  const states = await Promise.all(binaries.map(file => stat(join(runner, file)).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  })));
  return states.every(state => state?.isFile() && state.size > 0);
}
