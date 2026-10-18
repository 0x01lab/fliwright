import { MockRuleStore } from '@fliwright/core';
import { CliError } from '../CommandRegistry.js';
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
    const catalog = await mockListCommand(options);
    const rules = catalog.rules.filter((rule) => matches(rule, options));
    const routes = (await driver.mock.listFlutterRoutes()).filter((route) => matches(route, options));
    const calls = (await driver.mock.getFlutterCalls(options.endpoint)).filter((call) => !options.method || call.method.toUpperCase() === options.method.toUpperCase());
    return { connected: true, rules, routes, calls };
  }, deps);
}

export async function mockApplyCommand(
  options: MockCommandOptions & { endpoint: string; ruleName: string },
  deps: AppSessionDeps = {},
) {
  const mockDir = resolve(options.cwd ?? process.cwd(), options.mockDir ?? '.fliwright/mocks');
  const store = new MockRuleStore();
  await store.loadFromDirectory(mockDir);
  let response;
  try { response = store.switchRule(options.endpoint, options.ruleName, options.method); }
  catch (error) { throw new CliError('INVALID_INPUT', error instanceof Error ? error.message : String(error), 2); }
  const rule = store.listEndpoints().find((candidate) => matches(candidate, options));
  if (!response || !rule) throw new CliError('INVALID_INPUT', `Unknown mock rule: ${options.endpoint} ${options.ruleName}`, 2);
  return withAppSession(options, async ({ driver }) => {
    await driver.mock.routeFlutter(options.endpoint, { ...response, method: rule.method });
    return {
      applied: true,
      rule,
    };
  }, deps);
}

export async function mockClearCommand(options: AppSessionOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    await driver.mock.clearFlutterRoutes();
    await driver.mock.clearFlutterCalls();
    await driver.mock.setPassthrough(true);
    return { cleared: true };
  }, deps);
}

export async function mockCallsCommand(options: MockCommandOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    const calls = (await driver.mock.getFlutterCalls(options.endpoint)).filter((call) => (
      !options.method || call.method.toUpperCase() === options.method.toUpperCase()
    ));
    return { calls, count: calls.length };
  }, deps);
}

export async function mockClearCallsCommand(options: AppSessionOptions, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    await driver.mock.clearFlutterCalls();
    return { cleared: true, scope: 'calls' };
  }, deps);
}

function matches(
  value: { path?: string; endpoint?: string; method?: string },
  options: { endpoint?: string; method?: string },
): boolean {
  return (!options.endpoint || (value.path ?? value.endpoint) === options.endpoint)
    && (!options.method || value.method?.toUpperCase() === options.method.toUpperCase());
}
