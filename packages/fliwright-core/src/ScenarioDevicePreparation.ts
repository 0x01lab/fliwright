import { createHash } from 'node:crypto';
import { fingerprintScenario, ScenarioPreparationError, type ScenarioDeviceLayer, type ScenarioExecutionMode, type TestScenario } from './Scenario.js';
import type { NativeRuntime } from './native/NativeRuntime.js';

export interface ScenarioDeviceReport {
  scenarioFingerprint: string;
  deviceKey: string;
  platform: 'android' | 'ios';
  backend: string;
  generation: string;
  requiredCapabilities: string[];
  managedAppGeneration?: string;
}

/** A live, single-use handoff; JSON reports are not preparation credentials. */
export interface ScenarioDevicePreparation {
  consume(scenario: TestScenario, options: { mode: ScenarioExecutionMode; attemptId: string }): Promise<ScenarioDeviceReport>;
}

/** Structured capability failure; platform reasons stay in the supervisor. */
export class ScenarioDeviceCapabilityError extends ScenarioPreparationError {
  constructor(readonly capability: string, readonly state: 'unsupported' | 'unverified' | 'not-ready' | 'missing', reason?: string) {
    super(`Device preparation requires '${capability}' to be supported and ready (${state})${reason ? `: ${reason}` : '.'}`);
    this.name = 'ScenarioDeviceCapabilityError';
  }
}

/** Fixed capability vocabulary only: never serialize arbitrary scenario names or adapter text. */
export function scenarioDeviceCapabilityDiagnostic(error: unknown): string | undefined {
  if (!(error instanceof ScenarioDeviceCapabilityError)) return;
  const known = ['native.query', 'native.click', 'native.swipe', 'native.back', 'native.fill.basic', 'native.fill.unicode',
    'screen.capture', 'biometrics.match', 'biometrics.reject', 'media.import'];
  if (!known.includes(error.capability) || !['unsupported', 'unverified', 'not-ready', 'missing'].includes(error.state)) return;
  return `Required native capability '${error.capability}' is ${error.state}. Check device.capabilities() before selecting this scenario.`;
}

/** Fail before platform work when a declaration needs a lifecycle not yet implemented. */
export function validateScenarioDevicePreparation(scenario: TestScenario): ScenarioDeviceLayer | undefined {
  const layers = scenario.layers.filter((layer): layer is ScenarioDeviceLayer => layer.kind === 'device');
  if (layers.length > 1) throw new ScenarioPreparationError(`Scenario '${scenario.name}' writes 'device' more than once.`);
  const layer = layers[0];
  if (!layer) return;
  for (const field of ['baseline', 'biometricBaseline', 'permissions', 'media', 'cameraSource'] as const) {
    if (layer[field] !== undefined) throw new ScenarioPreparationError(
      `Scenario '${scenario.name}' device ${field} requires a verified preboot/prelaunch preparation lifecycle, which is not implemented by this session.`,
    );
  }
  return layer;
}

/** Verify read-only requirements before connecting the app, anew for each attempt. */
export async function prepareScenarioDevice(
  scenario: TestScenario,
  runtime: Pick<NativeRuntime, 'adapter' | 'device' | 'preflightCapabilities'>,
  options: { mode: ScenarioExecutionMode; attemptId: string; signal?: AbortSignal; managedAppGeneration?: string },
): Promise<ScenarioDevicePreparation | undefined> {
  const layer = validateScenarioDevicePreparation(scenario);
  if (!layer) return;
  if (!options.attemptId.trim()) throw new ScenarioPreparationError('Device preparation requires a current attempt ID.');
  const { mode, attemptId, signal } = options;
  const fingerprint = fingerprintScenario(scenario);
  const identity = { ...runtime.adapter.identity };
  const requiredCapabilities = [...new Set(layer.requiredCapabilities ?? [])];
  const assertIdentity = () => {
    signal?.throwIfAborted();
    for (const field of ['platform', 'deviceId', 'appId', 'backend', 'generation'] as const) {
      if (runtime.adapter.identity[field] !== identity[field]) throw new ScenarioPreparationError('Device preparation session identity changed.');
    }
  };
  const assertReady = async (preflight = false) => {
    assertIdentity();
    const capabilities = await (preflight ? runtime.preflightCapabilities({ signal }) : runtime.device.capabilities({ signal }));
    assertIdentity();
    for (const name of requiredCapabilities) {
      const capability = capabilities[name];
      if (!capability || capability.support !== 'supported' || !capability.ready) throw new ScenarioDeviceCapabilityError(name,
        !capability ? 'missing' : capability.support === 'supported' ? 'not-ready' : capability.support, capability?.reason);
    }
  };
  await assertReady(true);
  let consumed = false;
  return {
    async consume(current, context) {
      if (consumed) throw new ScenarioPreparationError('Device preparation was already consumed; prepare each attempt separately.');
      consumed = true;
      if (context.attemptId !== attemptId || context.mode !== mode || fingerprintScenario(current) !== fingerprint) {
        throw new ScenarioPreparationError('Device preparation does not match the current scenario, attempt or execution mode.');
      }
      await assertReady();
      return {
        scenarioFingerprint: fingerprint,
        deviceKey: createHash('sha256').update(`${identity.platform}\0${identity.deviceId}`).digest('hex'),
        platform: identity.platform, backend: identity.backend, generation: identity.generation,
        requiredCapabilities: [...requiredCapabilities],
        ...(options.managedAppGeneration ? { managedAppGeneration: options.managedAppGeneration } : {}),
      };
    },
  };
}
