import type { EndpointLease } from '@fliwright/core';
import type { RunnerTask } from 'vitest';
import { releaseTaskNativeSession } from './TaskNativeSession.js';

const leaseKey = Symbol.for('@fliwright/vitest/task-endpoint-lease');
const releaseErrorKey = Symbol.for('@fliwright/vitest/task-ownership-release-error');
const phasesKey = Symbol.for('@fliwright/vitest/task-ownership-phases');
type LeaseState = { lease: EndpointLease };
type LeaseTask = RunnerTask & { [leaseKey]?: LeaseState };
type ErrorTask = RunnerTask & { [releaseErrorKey]?: (error: unknown) => Promise<void> };
type PhaseTask = RunnerTask & { [phasesKey]?: {
  cleanupComplete?: boolean; skipFinalized?: boolean; finalize?: () => Promise<void>;
} };

export function setTaskOwnershipErrorHandler(task: RunnerTask, handler: (error: unknown) => Promise<void>): void {
  (task as ErrorTask)[releaseErrorKey] = handler;
}

/** The runner and fixtures may live in separate Vitest module graphs. */
export function getTaskEndpointLease(task: RunnerTask): EndpointLease | undefined {
  return (task as LeaseTask)[leaseKey]?.lease;
}

export function setTaskEndpointLease(task: RunnerTask, lease: EndpointLease): void {
  (task as LeaseTask)[leaseKey] = { lease };
}

/** Relaunch replaces endpoint ownership while retaining the task's device lease. */
export async function releaseTaskAppEndpoint(task: RunnerTask): Promise<void> {
  await getTaskEndpointLease(task)?.release();
  delete (task as LeaseTask)[leaseKey];
}

/** Runtime skip bypasses the final task hook; both runner and fixture must finish. */
export function resetTaskOwnershipPhases(task: RunnerTask): void {
  (task as PhaseTask)[phasesKey] = {};
}

export async function finishTaskEndpointLeasePhase(task: RunnerTask, phase: 'cleanupComplete' | 'skipFinalized', finalize?: () => Promise<void>): Promise<void> {
  const state = (task as PhaseTask)[phasesKey];
  // Plain Vitest tasks can use this runner without Fliwright's auto fixture.
  if (!state) {
    if (finalize) { await releaseTaskEndpointLease(task); await finalize(); }
    return;
  }
  state[phase] = true;
  if (finalize) state.finalize = finalize;
  if (state.cleanupComplete && state.skipFinalized) {
    delete (task as PhaseTask)[phasesKey];
    await releaseTaskEndpointLease(task);
    await state.finalize?.();
  }
}

export async function releaseTaskEndpointLease(task: RunnerTask): Promise<void> {
  const lease = getTaskEndpointLease(task);
  const errors: unknown[] = [];
  try { await lease?.release(); } catch (error) { errors.push(error); }
  delete (task as LeaseTask)[leaseKey];
  try { await releaseTaskNativeSession(task); }
  catch (error) { errors.push(...(error instanceof AggregateError ? error.errors : [error])); }
  for (const error of errors) {
    const handler = (task as ErrorTask)[releaseErrorKey];
    if (!handler) throw error;
    await handler(error);
  }
}
