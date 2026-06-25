/**
 * TDD Loop monitor view-model + mapping (design spec §4.3 / §5.4 / §6.2 / §10 P1).
 *
 * The panel renders a {@link TddLoopSnapshot} (the RuntimeSnapshot shape produced by the
 * MCP-owned `TddRuntime`) into a stable, UI-facing {@link TddLoopViewModel}. Keeping the
 * mapping in a pure, side-effect-free function lets us unit-test it without a VS Code host
 * (see `tests/TddLoopViewModel.test.ts`).
 *
 * DESIGN PRINCIPLE 4 (single driver by convention): the panel is READ-ONLY. This module never
 * touches a driver, a VM service, or the flutter daemon — it only shapes data someone else
 * produced. See {@link TddLoopStatusSource} for how the snapshot is obtained without creating a
 * second driver.
 */

/**
 * The RuntimeSnapshot shape, mirrored from `@fliwright/tdd` `RuntimeSnapshot`.
 *
 * Defined locally (not imported from `@fliwright/tdd`) so the VS Code extension does not take a
 * build-time dependency on the TDD package just to render a panel — the snapshot arrives via a
 * decoupled channel (file by default). Fields are all optional-ish; the source may write a partial
 * status. The shape matches `RuntimeSnapshot` in `packages/fliwright-tdd/src/types.ts`.
 */
export interface TddLoopSnapshot {
  connected: boolean;
  daemonStatus: 'running' | 'stopped' | 'unknown';
  appId?: string;
  supportsRestart: boolean;
  launchMode: 'start' | 'attach';
  restartCapable: boolean;
  driverConnections: number;
  fixtureDriverSharing: 'in-process-provider' | 'vm-service-url';
  notes?: string[];
  focusedTest?: { file: string; testName?: string };
  lastResult?: {
    status: 'red' | 'green';
    testName?: string;
    file: string;
    durationMs: number;
    lastSync: 'reload' | 'restart' | 'none';
    baselineVersion: number;
    failure?: { message?: string };
    unsupportedState?: string[];
  };
  baselineVersion: number;
  unsupportedState?: string[];
  /** Epoch millis when the snapshot was written by the source. Optional/unknown for live sources. */
  updatedAtMs?: number;
}

/** UI-facing view model. */
export interface TddLoopViewModel {
  /** Overall loop phase derived from `lastResult.status` (or `'idle'`). */
  phase: 'red' | 'green' | 'idle';
  /** Human label for the phase, ready to render as a badge. */
  phaseLabel: string;
  /** True when the runtime reports it is connected to a daemon-managed app. */
  connected: boolean;
  /** Daemon status verbatim. */
  daemonStatus: 'running' | 'stopped' | 'unknown';
  /** App id if known. */
  appId?: string;
  /** Launch mode verbatim (`start` = daemon-owned, `attach` = degraded). */
  launchMode: 'start' | 'attach';
  /** Whether hot restart is available; gates the take-over restart affordance. */
  restartCapable: boolean;
  /** Whether the underlying daemon supports restart. */
  supportsRestart: boolean;
  /** Number of runtime-owned driver connections (fixtures may add their own — §6.0). */
  driverConnections: number;
  /** How fixtures share the driver. `vm-service-url` is the 2.1.9 production model. */
  fixtureDriverSharing: 'in-process-provider' | 'vm-service-url';
  /** Focused test, formatted for display (file + name). */
  focusedTestLabel?: string;
  focusedTestFile?: string;
  focusedTestName?: string;
  /** Last cycle result summary. */
  lastResultStatus?: 'red' | 'green';
  lastResultDurationMs?: number;
  lastResultSync?: 'reload' | 'restart' | 'none';
  lastResultFailureMessage?: string;
  /** Monotonic baseline version. */
  baselineVersion: number;
  /** State categories the scenario claims but no reset adapter covers. */
  unsupportedState: string[];
  /** Free-form notes from the runtime. */
  notes: string[];
  /** Epoch millis when the snapshot was written, if known. */
  updatedAtMs?: number;
}

const PHASE_LABELS: Record<TddLoopViewModel['phase'], string> = {
  red: 'RED',
  green: 'GREEN',
  idle: 'Idle',
};

/**
 * Pure mapping from a {@link TddLoopSnapshot} to a {@link TddLoopViewModel}.
 *
 * Tolerates `undefined` input (returns an `idle` model) so the panel can render a harmless
 * placeholder before any snapshot has been written.
 */
export function toTddLoopViewModel(snapshot: TddLoopSnapshot | undefined | null): TddLoopViewModel {
  if (!snapshot) {
    return {
      phase: 'idle',
      phaseLabel: PHASE_LABELS.idle,
      connected: false,
      daemonStatus: 'stopped',
      launchMode: 'attach',
      restartCapable: false,
      supportsRestart: false,
      driverConnections: 0,
      fixtureDriverSharing: 'vm-service-url',
      baselineVersion: 0,
      unsupportedState: [],
      notes: [],
    };
  }

  const lastStatus = snapshot.lastResult?.status;
  const phase: TddLoopViewModel['phase'] = lastStatus === 'red' || lastStatus === 'green' ? lastStatus : 'idle';

  const focused = snapshot.focusedTest;
  const focusedTestLabel = focused
    ? focused.testName ? `${focused.testName} (${focused.file})` : focused.file
    : undefined;

  return {
    phase,
    phaseLabel: PHASE_LABELS[phase],
    connected: snapshot.connected,
    daemonStatus: snapshot.daemonStatus,
    appId: snapshot.appId,
    launchMode: snapshot.launchMode,
    restartCapable: snapshot.restartCapable,
    supportsRestart: snapshot.supportsRestart,
    driverConnections: snapshot.driverConnections,
    fixtureDriverSharing: snapshot.fixtureDriverSharing,
    focusedTestLabel,
    focusedTestFile: focused?.file,
    focusedTestName: focused?.testName,
    lastResultStatus: lastStatus,
    lastResultDurationMs: snapshot.lastResult?.durationMs,
    lastResultSync: snapshot.lastResult?.lastSync,
    lastResultFailureMessage: snapshot.lastResult?.failure?.message,
    baselineVersion: snapshot.baselineVersion,
    unsupportedState: snapshot.unsupportedState ?? [],
    notes: snapshot.notes ?? [],
    updatedAtMs: snapshot.updatedAtMs,
  };
}
