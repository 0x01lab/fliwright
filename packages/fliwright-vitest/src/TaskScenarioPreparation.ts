import { prepareScenarioDevice, ScenarioPreparationError, ScenarioResolver, validateScenarioDevicePreparation,
  type NativeConfig, type TestScenario, type ScenarioExecutionMode } from '@fliwright/core';
import type { RunnerTestCase } from 'vitest';
import { requireAttemptContext } from './AttemptContext.js';
import { taskNativeRuntime } from './TaskNativeSession.js';

/** Worker-only declaration metadata, retained by fixture extension and omitted from JSON. */
export const taskScenarioKey = Symbol.for('@fliwright/vitest/task-scenario');

export function taskScenario(task: RunnerTestCase, config: { defaultScenario?: string; scenarios?: Record<string, TestScenario> }): TestScenario | undefined {
  const explicit = (task.meta as { [taskScenarioKey]?: TestScenario })[taskScenarioKey];
  return explicit ?? (config.defaultScenario ? new ScenarioResolver(config.scenarios ?? {}).resolve(config.defaultScenario) : undefined);
}

export function validateTaskDeviceScenario(scenario: TestScenario | undefined, native: NativeConfig | undefined): void {
  if (!scenario || !validateScenarioDevicePreparation(scenario)) return;
  if (!native?.enabled) throw new ScenarioPreparationError(`Scenario '${scenario.name}' device preparation requires enabled native automation.`);
}

/** First setup runs outside the body timeout; automatic fixtures repeat this for retries. */
export async function prepareTaskDeviceScenario(task: RunnerTestCase, scenario: TestScenario | undefined,
  config: { native?: NativeConfig; scenarioMode?: ScenarioExecutionMode }, signal: AbortSignal): Promise<void> {
  validateTaskDeviceScenario(scenario, config.native);
  if (!scenario || !scenario.layers.some(layer => layer.kind === 'device')) return;
  const attempt = requireAttemptContext(task);
  if (attempt.devicePreparation) return;
  const runtime = await taskNativeRuntime(task, attempt.session, attempt.attemptId);
  attempt.devicePreparation = await prepareScenarioDevice(scenario, runtime, {
    mode: config.scenarioMode ?? 'attach', attemptId: attempt.attemptId, signal,
    managedAppGeneration: attempt.managedApp?.generation,
  });
}
