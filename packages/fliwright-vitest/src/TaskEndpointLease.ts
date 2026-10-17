import type { EndpointLease } from '@fliwright/core';
import type { RunnerTask } from 'vitest';

const leaseKey = Symbol.for('@fliwright/vitest/task-endpoint-lease');
type LeaseState = { lease: EndpointLease; cleanupComplete?: boolean; skipFinalized?: boolean };
type LeaseTask = RunnerTask & { [leaseKey]?: LeaseState };

/** The runner and fixtures may live in separate Vitest module graphs. */
export function getTaskEndpointLease(task: RunnerTask): EndpointLease | undefined {
  return (task as LeaseTask)[leaseKey]?.lease;
}

export function setTaskEndpointLease(task: RunnerTask, lease: EndpointLease): void {
  (task as LeaseTask)[leaseKey] = { lease };
}

/** Runtime skip bypasses the final task hook; both runner and fixture must finish. */
export async function finishTaskEndpointLeasePhase(task: RunnerTask, phase: 'cleanupComplete' | 'skipFinalized'): Promise<void> {
  const state = (task as LeaseTask)[leaseKey];
  if (!state) return;
  state[phase] = true;
  if (state.cleanupComplete && state.skipFinalized) await releaseTaskEndpointLease(task);
}

export async function releaseTaskEndpointLease(task: RunnerTask): Promise<void> {
  const lease = getTaskEndpointLease(task);
  if (!lease) return;
  try { await lease.release(); }
  finally { delete (task as LeaseTask)[leaseKey]; }
}
