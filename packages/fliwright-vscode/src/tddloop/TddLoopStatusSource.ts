/**
 * Read-only TDD Loop snapshot source (design spec §4.3 / §6.0 / principle 4).
 *
 * DATA-SOURCE APPROACH (chosen, with rationale):
 *
 * The TDD runtime (`TddRuntime`) lives in the MCP server process — a separate process owned by
 * the AI agent, lazily created on the first `fliwright_tdd_*` call. The VS Code extension does NOT
 * spawn or connect to the MCP server, does NOT connect to the Flutter VM service, and there is no
 * existing IPC channel between the two. Spawning an MCP client inside the extension just to read a
 * status field would add real coupling and (per task constraints) would risk a new npm dependency.
 *
 * The lightest additive channel that respects **single-driver ownership** (principle 4: only one
 * driver runs the loop at a time) is a **one-way status file**: the interested party (the MCP
 * runtime, or any user-configured provider) *may* write a JSON snapshot to a well-known workspace
 * path; this panel only ever **reads** it. The panel therefore never creates a `FliwrightDriver`,
 * never opens a VM-service WebSocket, and never drives the flutter daemon — it is impossible for it
 * to fight the MCP-driven loop. If no file exists the panel simply shows "no snapshot yet".
 *
 * This file is the single source of truth for the panel. It is intentionally write-agnostic: the
 * `@fliwright/tdd` runtime does not depend on `@fliwright/vscode`, so writing the file is left to
 * an optional integration point (the runtime can call its own writer, or a thin MCP-side hook can
 * serialize `runtime.snapshot()` here). The panel degrades gracefully when nothing writes.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TddLoopSnapshot } from './TddLoopViewModel.js';

/** Default status file location, relative to the workspace root. */
export const DEFAULT_TDD_STATUS_RELATIVE_PATH = path.join('.fliwright', 'tdd-status.json');

/**
 * Read-only source of TDD Loop snapshots. Implementations MUST NOT drive the app — only read.
 * The default {@link FileTddLoopStatusSource} reads a JSON file written by an external party.
 */
export interface TddLoopStatusSource {
  /** Returns the latest snapshot, or `undefined` when none is available. Never throws. */
  read(): Promise<TddLoopSnapshot | undefined>;
}

/**
 * File-backed read-only source. Reads (and tolerates the absence of) the JSON snapshot written by
 * an external party at `<workspaceRoot>/.fliwright/tdd-status.json` by default.
 */
export class FileTddLoopStatusSource implements TddLoopStatusSource {
  private readonly filePath: string;

  constructor(
    workspaceRoot: string | undefined,
    private readonly relativePath: string = DEFAULT_TDD_STATUS_RELATIVE_PATH,
  ) {
    this.filePath = workspaceRoot ? path.join(workspaceRoot, relativePath) : '';
  }

  async read(): Promise<TddLoopSnapshot | undefined> {
    if (!this.filePath) return undefined;
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch {
      // Missing or unreadable file → no snapshot yet (panel renders a placeholder).
      return undefined;
    }
    try {
      return normalizeSnapshot(JSON.parse(raw));
    } catch {
      return undefined;
    }
  }
}

/**
 * Coerce an unknown parsed object into a {@link TddLoopSnapshot}, defaulting unknown fields.
 * Exported for tests. Never throws; a structurally unusable payload yields `undefined`.
 */
export function normalizeSnapshot(input: unknown): TddLoopSnapshot | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;

  // Require the minimal truthy-ish connected flag to be present; otherwise treat as no snapshot.
  if (typeof obj.connected !== 'boolean') return undefined;

  const daemonStatus = obj.daemonStatus === 'running' || obj.daemonStatus === 'stopped' || obj.daemonStatus === 'unknown'
    ? obj.daemonStatus
    : 'unknown';

  const launchMode = obj.launchMode === 'start' || obj.launchMode === 'attach' ? obj.launchMode : 'attach';

  const fixtureDriverSharing = obj.fixtureDriverSharing === 'in-process-provider' || obj.fixtureDriverSharing === 'vm-service-url'
    ? obj.fixtureDriverSharing
    : 'vm-service-url';

  const focusedTest = normalizeFocusedTest(obj.focusedTest);
  const lastResult = normalizeLastResult(obj.lastResult);

  return {
    connected: obj.connected,
    daemonStatus,
    appId: typeof obj.appId === 'string' ? obj.appId : undefined,
    supportsRestart: Boolean(obj.supportsRestart),
    launchMode,
    restartCapable: Boolean(obj.restartCapable),
    driverConnections: Number.isFinite(obj.driverConnections as number) ? (obj.driverConnections as number) : 0,
    fixtureDriverSharing,
    notes: Array.isArray(obj.notes) ? obj.notes.filter((n): n is string => typeof n === 'string') : [],
    focusedTest,
    lastResult,
    baselineVersion: Number.isFinite(obj.baselineVersion as number) ? (obj.baselineVersion as number) : 0,
    unsupportedState: Array.isArray(obj.unsupportedState)
      ? obj.unsupportedState.filter((s): s is string => typeof s === 'string')
      : [],
    updatedAtMs: Number.isFinite(obj.updatedAtMs as number) ? (obj.updatedAtMs as number) : undefined,
  };
}

function normalizeFocusedTest(input: unknown): TddLoopSnapshot['focusedTest'] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  if (typeof obj.file !== 'string') return undefined;
  return {
    file: obj.file,
    testName: typeof obj.testName === 'string' ? obj.testName : undefined,
  };
}

function normalizeLastResult(input: unknown): TddLoopSnapshot['lastResult'] | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;
  if (obj.status !== 'red' && obj.status !== 'green') return undefined;
  if (typeof obj.file !== 'string') return undefined;
  const lastSync = obj.lastSync === 'reload' || obj.lastSync === 'restart' || obj.lastSync === 'none'
    ? obj.lastSync
    : 'none';
  const failure = obj.failure && typeof obj.failure === 'object'
    ? { message: typeof (obj.failure as Record<string, unknown>).message === 'string'
        ? (obj.failure as Record<string, unknown>).message as string
        : undefined }
    : undefined;
  return {
    status: obj.status,
    testName: typeof obj.testName === 'string' ? obj.testName : undefined,
    file: obj.file,
    durationMs: Number.isFinite(obj.durationMs as number) ? (obj.durationMs as number) : 0,
    lastSync,
    baselineVersion: Number.isFinite(obj.baselineVersion as number) ? (obj.baselineVersion as number) : 0,
    failure,
    unsupportedState: Array.isArray(obj.unsupportedState)
      ? obj.unsupportedState.filter((s): s is string => typeof s === 'string')
      : [],
  };
}
