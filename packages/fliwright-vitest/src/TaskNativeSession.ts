import { NativeError, createAndroidAppReadback, fingerprintScenario, getAndroidScenarioPermissions, type NativeConfig, type NativeRuntime, type RunSession, type TestScenario } from '@fliwright/core';
import { openNativeDevice, type NativeDeviceSession } from '@fliwright/native';
import type { RunnerTask, RunnerTestCase } from 'vitest';
import { requireAttemptContext } from './AttemptContext.js';

export type NativeDeviceProvider = (config: NativeConfig, options: { signal: AbortSignal }) => Promise<NativeDeviceSession>;
const nativeKey = Symbol.for('@fliwright/vitest/task-native-session');
interface NativeState {
  owner: NativeDeviceSession;
  config: string;
  runtime?: NativeRuntime;
  attemptId?: string;
  bindingAttemptId?: string;
  quarantined?: boolean;
}
type NativeTask = RunnerTask & { [nativeKey]?: NativeState };
const stateFor = (task: RunnerTask) => (task as NativeTask)[nativeKey];
export function hasTaskNativeRuntime(task: RunnerTask): boolean { return !!stateFor(task)?.runtime; }

/** Called before acquiring the endpoint so separate VM URLs cannot bypass device exclusion. */
export async function prepareTaskNativeSession(task: RunnerTask, config: NativeConfig | undefined,
  signal: AbortSignal, provider: NativeDeviceProvider = openNativeDevice): Promise<void> {
  if (!config?.enabled) return;
  const existing = stateFor(task);
  if (existing) {
    if (existing.quarantined) throw new NativeError('cleanup_failed', 'Managed app cleanup was not confirmed; restore the device before starting another attempt.');
    if (existing.config !== JSON.stringify(config)) throw new NativeError('device_mismatch', 'Native configuration changed while this test owns the device.');
    return;
  }
  const owner = await provider(config, { signal });
  if (signal.aborted) { await owner.dispose(); throw new NativeError('cancelled', 'Native preparation cancelled.'); }
  (task as NativeTask)[nativeKey] = { owner, config: JSON.stringify(config) };
}

export async function quarantineTaskNativeSession(task: RunnerTask): Promise<void> {
  const state = stateFor(task);
  if (!state) return;
  state.quarantined = true;
  if (!state.owner.quarantine) throw new NativeError('cleanup_failed', 'Native device provider cannot quarantine unconfirmed app cleanup.');
  await state.owner.quarantine('Managed app connection cleanup was not confirmed.');
}

export async function taskNativeRuntime(task: RunnerTestCase, session: RunSession, attemptId: string): Promise<NativeRuntime> {
  const state = stateFor(task);
  if (!state) throw new NativeError('precondition_failed', 'Enable native automation and select a device/target app in the run configuration before using native or device fixtures.');
  if (state.runtime && state.attemptId !== attemptId) throw new NativeError('precondition_failed', 'The preceding native attempt was not cleaned up.');
  if (!state.runtime) {
    state.runtime = await state.owner.createRuntime({ signal: task.context.signal, runtime: { runSession: session } });
    state.attemptId = attemptId;
  }
  return state.runtime;
}

export async function verifyTaskNativeBinding(task: RunnerTestCase, driver: { sendRequest(method: string): Promise<unknown> }, attemptId: string,
  scenario?: TestScenario): Promise<void> {
  const state = stateFor(task);
  const attempt = requireAttemptContext(task), expected = attempt.managedApp?.nativeApp;
  if (!state) {
    if (expected) throw new NativeError('precondition_failed', 'Android app readback requires the current native owner.');
    return;
  }
  if (state.bindingAttemptId === attemptId) return;
  const signal = AbortSignal.any([task.context.signal, AbortSignal.timeout(expected ? 30000 : 5000)]);
  let abort: (() => void) | undefined;
  try {
    const vm = await Promise.race([driver.sendRequest('getVM'), new Promise<never>((_, reject) => {
      abort = () => reject(new NativeError('device_mismatch', 'Flutter VM process identity could not be read within the binding budget.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
    const pid = vm && typeof vm === 'object' && 'pid' in vm ? vm.pid : undefined;
    await state.owner.verifyAppProcess(pid, { signal });
    if (expected) {
      const node = attempt.recorder.startNode('step', 'Android app readback');
      try {
        if (!state.runtime || state.attemptId !== attemptId || !state.owner.inspectAppState || pid !== expected.pid) {
          throw new NativeError('device_mismatch', 'Android app readback requires independent current process and native observation.');
        }
        const context = { attemptKey: `${attempt.runId}/${task.id}/${attemptId}`, attemptId,
          managedAppGeneration: attempt.managedApp!.generation, signal,
          get scenarioFingerprint() { return scenario ? fingerprintScenario(scenario) : undefined; },
          get permissionDeclaration() { return getAndroidScenarioPermissions(scenario); },
          get identity() {
            if (!state.runtime || state.attemptId !== attemptId) throw new NativeError('device_mismatch', 'Android app readback runtime identity changed.');
            return state.runtime.adapter.identity;
          },
        };
        const readback = createAndroidAppReadback(expected, context,
          () => state.owner.inspectAppState!(expected.permissions.map(item => item.permission), { signal, timeout: 30000 }));
        attempt.androidReadback = await readback.consume(context);
        attempt.recorder.passNode(node.id, { ...attempt.androidReadback });
      } catch (error) {
        attempt.recorder.failNode(node.id, { code: 'unknown', title: 'Android app readback', message: 'Independent Android app readback failed.', recoveryHints: [] });
        throw error;
      }
    }
    signal.throwIfAborted();
    state.bindingAttemptId = attemptId;
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}

export async function disposeTaskNativeAttempt(task: RunnerTask): Promise<void> {
  const state = stateFor(task);
  if (!state?.runtime) return;
  try { await state.runtime.dispose(); }
  finally { state.runtime = undefined; state.attemptId = undefined; state.bindingAttemptId = undefined; }
}

/** Release last, after endpoint ownership and all attempt evidence have finished. */
export async function releaseTaskNativeSession(task: RunnerTask): Promise<void> {
  const state = stateFor(task);
  if (!state) return;
  const errors: unknown[] = [];
  try {
    try { await disposeTaskNativeAttempt(task); } catch (error) { errors.push(error); }
    try { await state.owner.dispose(); } catch (error) { errors.push(error); }
  } finally { delete (task as NativeTask)[nativeKey]; }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, 'Native attempt and device ownership cleanup failed.');
}
