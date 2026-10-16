import { MockRuleStore } from '@fliwright/core';
import { resolve } from 'node:path';
import { withAppSession, type AppSessionDeps, type AppSessionOptions } from '../capabilities/session.js';

export interface MockCommandOptions extends AppSessionOptions {
  mockDir?: string;
  endpoint?: string;
  method?: string;
}

export async function mockListCommand(options: MockCommandOptions = {}) {
  const mockDir = resolve(options.cwd ?? process.cwd(), options.mockDir ?? '.fliwright/mocks');
  const store = new MockRuleStore();
  await store.loadFromDirectory(mockDir);
  return { mockDir, rules: store.listEndpoints() };
}

export async function mockStatusCommand(options: MockCommandOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    await driver.mock.loadRules(resolve(options.cwd ?? process.cwd(), options.mockDir ?? '.fliwright/mocks'));
    const rules = driver.mock.listRules().filter((rule) => matches(rule, options));
    const routes = (await driver.mock.listRoutes()).filter((route) => matches(route, options));
    const calls = (await driver.mock.getCalls(options.endpoint)).filter((call) => !options.method || call.method.toUpperCase() === options.method.toUpperCase());
    return { connected: true, rules, routes, calls };
  }, deps);
}

export async function mockApplyCommand(
  options: MockCommandOptions & { endpoint: string; ruleName: string },
  deps: AppSessionDeps = {},
) {
  return withAppSession(options, async ({ driver }) => {
    const mockDir = resolve(options.cwd ?? process.cwd(), options.mockDir ?? '.fliwright/mocks');
    await driver.mock.loadRules(mockDir);
    await driver.mock.switchRule(options.endpoint, options.ruleName, options.method);
    return {
      applied: true,
      rule: driver.mock.listRules().find((candidate) => matches(candidate, options)),
    };
  }, deps);
}

export async function mockClearCommand(options: AppSessionOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    await driver.mock.clearFlutterRoutes();
    await driver.mock.clearCalls();
    await driver.mock.setPassthrough(true);
    return { cleared: true };
  }, deps);
}

export async function mockCallsCommand(options: MockCommandOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    const calls = (await driver.mock.getCalls(options.endpoint)).filter((call) => (
      !options.method || call.method.toUpperCase() === options.method.toUpperCase()
    ));
    return { calls, count: calls.length };
  }, deps);
}

function matches(
  value: { path?: string; endpoint?: string; method?: string },
  options: { endpoint?: string; method?: string },
): boolean {
  return (!options.endpoint || (value.path ?? value.endpoint) === options.endpoint)
    && (!options.method || value.method?.toUpperCase() === options.method.toUpperCase());
}
