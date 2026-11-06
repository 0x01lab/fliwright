import { resolveProjectConfig } from '../config.js';
import { dirname, extname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { defaultStatusFilePath, TddRuntime } from '@fliwright/tdd';
import { ScenarioResolver } from '@fliwright/core';
import type { CycleOpts, RuntimeSnapshot, TddCycleResult } from '@fliwright/tdd';

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
  scenario?: string;
  statusFile?: string;
  keepAppAlive?: boolean;
  json?: boolean;
  print?: boolean;
  signal?: AbortSignal;
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
  signal?: AbortSignal;
}

export interface TddCommandDeps {
  createRuntime?: () => TddRuntime;
  resolveConfig?: typeof resolveProjectConfig;
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

  const projectRoot = extname(options.configRoot) ? dirname(options.configRoot) : options.configRoot;
  const config = await (deps.resolveConfig ?? resolveProjectConfig)(projectRoot);
  if (options.scenario) new ScenarioResolver(config.scenarios ?? {}).resolve(options.scenario);
  const runtime = deps.createRuntime?.() ?? new TddRuntime();
  const print = options.print ?? true;
  let snapshot: RuntimeSnapshot;
  let result: TddCycleResult;
  let stopped: RuntimeSnapshot;
  const abort = () => { void runtime.cancel(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    snapshot = await runtime.start({
      configRoot: options.configRoot, sharedConfig: config,
      vmServiceUrl: options.vmUrl,
      app: options.deviceId ? { deviceId: options.deviceId, projectId: options.projectId,
        target: options.target, flutterArgs: options.flutterArgs, mode: options.mode } : undefined,
      launchMode: options.vmUrl ? 'attach' : 'start', defaultScenario: options.scenario,
      statusFilePath: options.statusFile ?? defaultStatusFilePath(options.configRoot),
    });
    options.signal?.throwIfAborted();
    await runtime.focus(resolve(projectRoot, options.file), options.testName);
    result = await runtime.cycle(options.testName, { sync: options.sync ?? 'none', changes: options.changes,
      fullReset: options.fullReset, autoEscalate: options.autoEscalate ?? true, timeoutMs: options.timeoutMs });
    options.signal?.throwIfAborted();
  } finally {
    options.signal?.removeEventListener('abort', abort);
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

  let snapshot: RuntimeSnapshot;
  let synced: { lastSync: TddSyncMode; snapshot: RuntimeSnapshot };
  let stopped: RuntimeSnapshot;
  const abort = () => { void runtime.cancel(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    snapshot = await runtime.start({
      configRoot: options.configRoot,
      sharedConfig: await resolveProjectConfig(extname(options.configRoot) ? dirname(options.configRoot) : options.configRoot),
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

    options.signal?.throwIfAborted();
    synced = await runtime.syncApp(options.sync);
    options.signal?.throwIfAborted();
  } finally {
    options.signal?.removeEventListener('abort', abort);
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
