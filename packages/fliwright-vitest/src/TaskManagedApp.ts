import { fingerprintScenario, prepareManagedAppAttempt, readManagedAppControl, ScenarioPreparationError,
  type ScenarioExecutionMode, type TestScenario } from '@fliwright/core';
import type { RunnerTestCase } from 'vitest';
import { requireAttemptContext } from './AttemptContext.js';
import { disposeTaskNativeAttempt } from './TaskNativeSession.js';
import { releaseTaskAppEndpoint } from './TaskEndpointLease.js';

const dirtyKey = Symbol.for('@fliwright/vitest/managed-app-cleanup-unconfirmed');
type ManagedTask = RunnerTestCase & { [dirtyKey]?: boolean };
export function blockTaskManagedApp(task: RunnerTestCase): void { (task as ManagedTask)[dirtyKey] = true; }

/** Runs before the attempt's Adapter, endpoint acquisition and all Bridge work. */
export async function prepareTaskManagedApp(task: RunnerTestCase, scenario: TestScenario | undefined,
  mode: ScenarioExecutionMode | undefined, signal: AbortSignal, nativeEnabled = false): Promise<void> {
  if (mode !== 'managed-start' || !nativeEnabled) return;
  if ((task as ManagedTask)[dirtyKey]) throw new ScenarioPreparationError('The previous managed app connection cleanup was not confirmed; a new managed run is required.');
  const attempt = requireAttemptContext(task);
  if (attempt.managedApp) return;
  const control = readManagedAppControl();
  if (!control) throw new ScenarioPreparationError('Managed device scenarios require a live app supervisor. Use managed CLI run/script or a Cloud Worker.');
  signal.throwIfAborted();
  await disposeTaskNativeAttempt(task);
  await releaseTaskAppEndpoint(task);
  attempt.managedApp = await prepareManagedAppAttempt(control, {
    attemptKey: `${attempt.runId}/${task.id}/${attempt.attemptId}`,
    ...(scenario ? { scenarioName: scenario.name, scenarioFingerprint: fingerprintScenario(scenario) } : {}),
  }, { signal });
}
