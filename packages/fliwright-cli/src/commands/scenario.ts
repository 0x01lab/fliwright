import { ScenarioCoordinator, ScenarioResolver } from '@fliwright/core';
import { loadConfig } from '../config.js';
import { withAppSession, type AppSessionDeps, type AppSessionOptions } from '../capabilities/session.js';

export async function scenarioListCommand(options: { cwd?: string } = {}) {
  const config = await loadConfig(options.cwd ?? process.cwd());
  return {
    scenarios: Object.keys(config.scenarios ?? {}).sort().map((name) => ({
      name,
      startupIsolation: config.scenarios?.[name]?.startupIsolation ?? 'optional',
      layers: config.scenarios?.[name]?.layers.map((layer) => layer.kind) ?? [],
    })),
  };
}

export async function scenarioApplyCommand(
  options: AppSessionOptions & { name: string; mode?: 'managed-start' | 'attach' },
  deps: AppSessionDeps = {},
) {
  const config = await loadConfig(options.cwd ?? process.cwd());
  const scenario = new ScenarioResolver(config.scenarios ?? {}).resolve(options.name);
  return withAppSession(options, ({ driver }) => new ScenarioCoordinator(driver).apply(scenario, {
    mode: options.mode ?? config.scenarioMode ?? 'attach',
  }), deps);
}

export async function scenarioResetCommand(
  options: AppSessionOptions & { homeRoute?: string },
  deps: AppSessionDeps = {},
) {
  return withAppSession(options, async ({ driver }) => {
    await driver.mock.clearFlutterRoutes();
    await driver.mock.clearCalls();
    await driver.mock.setPassthrough(true);
    const storage = await driver.storage.reset({});
    await driver.page.resetToHome({ homeRoute: options.homeRoute ?? '/' });
    return {
      reset: true,
      homeRoute: options.homeRoute ?? '/',
      storage: storage.status,
      mocks: 'cleared',
    };
  }, deps);
}
