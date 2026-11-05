import { ManagedAppLifecycle, ScenarioResolver, fingerprintScenario, validateScenarioDevicePreparation, type ManagedAppAttemptRequest, type ManagedAppLaunchEndpoint, type ManagedAppPhaseReporter, type TestScenario } from '@fliwright/core';
import { resolveProjectConfig } from './config.js';

/** Shared by CLI and Worker; platform process ownership remains with the launcher. */
export async function startManagedAppControl(cwd: string, options: {
  stop(signal: AbortSignal, request: ManagedAppAttemptRequest, reportPhase: ManagedAppPhaseReporter): Promise<void>;
  launch(signal: AbortSignal, request: ManagedAppAttemptRequest, reportPhase: ManagedAppPhaseReporter): Promise<ManagedAppLaunchEndpoint>;
  /** Retained device owner prepares only after the old app has stopped. */
  prepareDevice?(request: ManagedAppAttemptRequest, signal: AbortSignal, scenario?: TestScenario): Promise<void>;
  /** Interrupts owned startup/stop waits when the client or preparation budget expires. */
  cancel?(): Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  onError?(error: unknown): void;
}) {
  const config = await resolveProjectConfig(cwd);
  const resolver = new ScenarioResolver(config.scenarios ?? {});
  const lifecycle = new ManagedAppLifecycle({ signal: options.signal, timeoutMs: options.timeoutMs, cleanupTimeoutMs: options.cleanupTimeoutMs, onError: options.onError, async prepare(request, signal, reportPhase) {
    reportPhase('validate-scenario');
    const scenario = request.scenarioName ? resolver.resolve(request.scenarioName) : undefined;
    if (scenario && fingerprintScenario(scenario) !== request.scenarioFingerprint) {
      throw new Error('Managed attempt scenario differs from the launch configuration.');
    }
    if (scenario) validateScenarioDevicePreparation(scenario);
    let cancelling: Promise<void> | undefined;
    const onAbort = () => { cancelling ??= options.cancel?.(); void cancelling?.catch(() => undefined); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      signal.throwIfAborted();
      reportPhase('stop-app');
      await options.stop(signal, request, reportPhase);
      signal.throwIfAborted();
      reportPhase('prepare-device');
      await options.prepareDevice?.(request, signal, scenario);
      signal.throwIfAborted();
      reportPhase('launch-app');
      const endpoint = await options.launch(signal, request, reportPhase);
      signal.throwIfAborted();
      return endpoint;
    } finally {
      signal.removeEventListener('abort', onAbort);
      await cancelling;
    }
  } });
  try {
    const control = await lifecycle.start();
    return { control, dispose: () => lifecycle.dispose() };
  } catch (error) { await lifecycle.dispose(); throw error; }
}
