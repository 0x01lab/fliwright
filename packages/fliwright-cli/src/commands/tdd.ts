import { readFile } from 'node:fs/promises';
import { defaultStatusFilePath, TddRuntime } from '@fliwright/tdd';
import type { CycleOpts, RuntimeSnapshot, StartOpts, TddCycleResult } from '@fliwright/tdd';

type TddCliResetCategory =
  | 'navigation'
  | 'riverpod'
  | 'mock'
  | 'storage'
  | 'secureStorage'
  | 'authTokens'
  | 'webview'
  | 'localDb'
  | 'timers'
  | 'isolates'
  | 'permissions';

interface TddCliScenario {
  homeRoute: string;
  resetCategories: TddCliResetCategory[];
  riverpodOverrides?: unknown[];
  mockProfile?: string;
  mockDir?: string;
  storageSeed?: Record<string, unknown>;
}

export interface TddCycleCommandOptions {
  configRoot: string;
  vmUrl?: string;
  deviceId?: string;
  projectId?: string;
  target?: string;
  flutterArgs?: string[];
  mode?: 'run' | 'drive';
  file: string;
  testName?: string;
  sync?: CycleOpts['sync'];
  changes?: string[];
  fullReset?: boolean;
  autoEscalate?: boolean;
  timeoutMs?: number;
  homeRoute?: string;
  resetCategories?: TddCliResetCategory[];
  riverpodOverrideJson?: string[];
  mockProfile?: string;
  mockDir?: string;
  storageSeedJson?: string;
  statusFile?: string;
  keepAppAlive?: boolean;
  json?: boolean;
  print?: boolean;
}

export interface TddStatusCommandOptions {
  configRoot: string;
  statusFile?: string;
  json?: boolean;
  print?: boolean;
}

type TddSyncMode = 'none' | 'reload' | 'restart';

export interface TddSyncCommandOptions {
  configRoot: string;
  vmUrl?: string;
  deviceId?: string;
  projectId?: string;
  target?: string;
  flutterArgs?: string[];
  mode?: 'run' | 'drive';
  sync: TddSyncMode;
  statusFile?: string;
  keepAppAlive?: boolean;
  json?: boolean;
  print?: boolean;
}

export interface TddCommandDeps {
  createRuntime?: () => TddRuntime;
  readFile?: typeof readFile;
  log?: (message: string) => void;
}

export interface TddCycleCommandResult {
  snapshot: RuntimeSnapshot;
  result: TddCycleResult;
  stopped: RuntimeSnapshot;
}

export interface TddSyncCommandResult {
  snapshot: RuntimeSnapshot;
  lastSync: TddSyncMode;
  synced: RuntimeSnapshot;
  stopped: RuntimeSnapshot;
}

export async function tddCycleCommand(
  options: TddCycleCommandOptions,
  deps: TddCommandDeps = {},
): Promise<TddCycleCommandResult> {
  if (!options.vmUrl && !options.deviceId) {
    throw new Error('fliwright tdd cycle requires either --vm-url or --device-id.');
  }

  const runtime = deps.createRuntime?.() ?? new TddRuntime();
  const scenario: TddCliScenario = {
    homeRoute: options.homeRoute ?? '/',
    resetCategories: options.resetCategories ?? ['navigation', 'mock'],
    riverpodOverrides: parseRiverpodOverrideJson(options.riverpodOverrideJson),
    mockProfile: options.mockProfile,
    mockDir: options.mockDir,
    storageSeed: parseStorageSeedJson(options.storageSeedJson),
  };
  const statusFilePath = options.statusFile ?? defaultStatusFilePath(options.configRoot);
  const print = options.print ?? true;

  const snapshot = await runtime.start({
    configRoot: options.configRoot,
    vmServiceUrl: options.vmUrl,
    app: options.deviceId
      ? {
        deviceId: options.deviceId,
        projectId: options.projectId,
        target: options.target,
        flutterArgs: options.flutterArgs,
        mode: options.mode,
      }
      : undefined,
    launchMode: options.vmUrl ? 'attach' : 'start',
    scenario: scenario as StartOpts['scenario'],
    statusFilePath,
  });

  let result: TddCycleResult;
  let stopped: RuntimeSnapshot | undefined;
  try {
    await runtime.focus(options.file, options.testName);
    result = await runtime.cycle(options.testName, {
      sync: options.sync ?? 'none',
      changes: options.changes,
      fullReset: options.fullReset,
      autoEscalate: options.autoEscalate ?? true,
      timeoutMs: options.timeoutMs,
    });
  } finally {
    await runtime.stop({ keepAppAlive: options.keepAppAlive ?? Boolean(options.vmUrl) });
    stopped = runtime.snapshot();
  }

  if (print) {
    const output = options.json
      ? JSON.stringify({ snapshot, result, stopped }, null, 2)
      : formatCycleResult(result, stopped);
    (deps.log ?? console.log)(output);
  }

  return { snapshot, result, stopped };
}

export async function tddSyncCommand(
  options: TddSyncCommandOptions,
  deps: TddCommandDeps = {},
): Promise<TddSyncCommandResult> {
  if (!options.vmUrl && !options.deviceId) {
    throw new Error('fliwright tdd sync requires either --vm-url or --device-id.');
  }
  if (!['none', 'reload', 'restart'].includes(options.sync)) {
    throw new Error('fliwright tdd sync mode must be one of: none, reload, restart.');
  }

  const runtime = deps.createRuntime?.() ?? new TddRuntime();
  const statusFilePath = options.statusFile ?? defaultStatusFilePath(options.configRoot);
  const print = options.print ?? true;

  const snapshot = await runtime.start({
    configRoot: options.configRoot,
    vmServiceUrl: options.vmUrl,
    app: options.deviceId
      ? {
        deviceId: options.deviceId,
        projectId: options.projectId,
        target: options.target,
        flutterArgs: options.flutterArgs,
        mode: options.mode,
      }
      : undefined,
    launchMode: options.vmUrl ? 'attach' : 'start',
    statusFilePath,
  });

  const syncRuntime = runtime as TddRuntime & {
    syncApp(sync: TddSyncMode): Promise<{ lastSync: TddSyncMode; snapshot: RuntimeSnapshot }>;
  };

  let synced: { lastSync: TddSyncMode; snapshot: RuntimeSnapshot };
  let stopped: RuntimeSnapshot | undefined;
  try {
    synced = await syncRuntime.syncApp(options.sync);
  } finally {
    await runtime.stop({ keepAppAlive: options.keepAppAlive ?? Boolean(options.vmUrl) });
    stopped = runtime.snapshot();
  }

  if (print) {
    const output = options.json
      ? JSON.stringify({ snapshot, lastSync: synced.lastSync, synced: synced.snapshot, stopped }, null, 2)
      : formatSyncResult(synced.lastSync, synced.snapshot, stopped);
    (deps.log ?? console.log)(output);
  }

  return {
    snapshot,
    lastSync: synced.lastSync,
    synced: synced.snapshot,
    stopped,
  };
}

export async function tddStatusCommand(
  options: TddStatusCommandOptions,
  deps: TddCommandDeps = {},
): Promise<RuntimeSnapshot | null> {
  const statusFilePath = options.statusFile ?? defaultStatusFilePath(options.configRoot);
  const print = options.print ?? true;
  const read = deps.readFile ?? readFile;
  let snapshot: RuntimeSnapshot | null = null;

  try {
    snapshot = JSON.parse(await read(statusFilePath, 'utf8')) as RuntimeSnapshot;
  } catch {
    snapshot = null;
  }

  if (print) {
    const output = options.json
      ? JSON.stringify(snapshot, null, 2)
      : snapshot
        ? formatSnapshot(snapshot)
        : `No TDD runtime status found at ${statusFilePath}`;
    (deps.log ?? console.log)(output);
  }

  return snapshot;
}

function formatCycleResult(result: TddCycleResult, stopped: RuntimeSnapshot): string {
  const lines = [
    `TDD ${result.status.toUpperCase()}: ${result.testName ?? '(focused test)'}`,
    `file: ${result.file}`,
    `duration: ${result.durationMs}ms`,
    `sync: ${result.lastSync}`,
    `baseline: ${result.baselineVersion}`,
  ];
  if (result.failure?.message) lines.push(`failure: ${result.failure.message}`);
  if (result.unsupportedState?.length) lines.push(`unsupported state: ${result.unsupportedState.join(', ')}`);
  lines.push(`runtime: ${stopped.connected ? 'running' : 'stopped'}`);
  return lines.join('\n');
}

function formatSyncResult(lastSync: TddSyncMode, synced: RuntimeSnapshot, stopped: RuntimeSnapshot): string {
  const lines = [
    `TDD sync: ${lastSync}`,
    `runtime: ${stopped.connected ? 'running' : 'stopped'}`,
    `launch mode: ${synced.launchMode}`,
    `restart capable: ${synced.restartCapable ? 'yes' : 'no'}`,
    `baseline: ${synced.baselineVersion}`,
  ];
  return lines.join('\n');
}

function formatSnapshot(snapshot: RuntimeSnapshot): string {
  const lines = [
    `TDD runtime: ${snapshot.connected ? 'connected' : 'stopped'}`,
    `daemon: ${snapshot.daemonStatus}`,
    `launch mode: ${snapshot.launchMode}`,
    `restart capable: ${snapshot.restartCapable ? 'yes' : 'no'}`,
    `baseline: ${snapshot.baselineVersion}`,
  ];
  if (snapshot.focusedTest) {
    lines.push(`focused: ${snapshot.focusedTest.testName ? `${snapshot.focusedTest.testName} ` : ''}${snapshot.focusedTest.file}`);
  }
  if (snapshot.lastResult) {
    lines.push(`last result: ${snapshot.lastResult.status} (${snapshot.lastResult.durationMs}ms)`);
  }
  if (snapshot.unsupportedState?.length) lines.push(`unsupported state: ${snapshot.unsupportedState.join(', ')}`);
  return lines.join('\n');
}

function parseStorageSeedJson(input: string | undefined): Record<string, unknown> | undefined {
  if (input === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`--storage-seed-json must be valid JSON: ${detail}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--storage-seed-json must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function parseRiverpodOverrideJson(inputs: string[] | undefined): unknown[] | undefined {
  if (!inputs?.length) return undefined;
  return inputs.map((input, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`--riverpod-override-json[${index}] must be valid JSON: ${detail}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`--riverpod-override-json[${index}] must be a JSON object.`);
    }
    const record = parsed as Record<string, unknown>;
    const hasKey = typeof record.provider === 'string' || typeof record.key === 'string';
    if (!hasKey || !Object.prototype.hasOwnProperty.call(record, 'value')) {
      throw new Error(`--riverpod-override-json[${index}] must include { provider | key, value }.`);
    }
    return record;
  });
}
