import { z } from 'zod';
import { defaultStatusFilePath } from '@fliwright/tdd';
import { tddCycleCommand, tddStatusCommand, tddSyncCommand } from '../commands/tdd.js';
import { dirname, extname, resolve } from 'node:path';
import { ScenarioResolver } from '@fliwright/core';
import { CliError, type CommandRegistry } from '../CommandRegistry.js';
import type { ConnectionHost } from '../session/ConnectionHost.js';
import { loadConfig, resolveProjectConfig } from '../config.js';
import { str, bool, positive } from './finite.js';
const cycle = { testName: str, sync: z.enum(['none', 'reload', 'restart', 'auto']).optional(), fullReset: bool,
  changes: z.array(z.string()).optional(), autoEscalate: bool, timeoutMs: positive };
export function registerTdd(registry: CommandRegistry, host?: ConnectionHost): void {
  const add = (name: string, input: z.AnyZodObject, execute: (input: any, context: any) => unknown, persistent = true) => registry.add({
    path: name, description: name.replaceAll('.', ' '), input, needsSession: persistent, effects: ['tdd-workflow'],
    async execute(input, context) {
      if (persistent && !host) throw new CliError('SESSION_REQUIRED', 'Use --session from session open for persistent TDD.', 2);
      return execute(input, context);
    },
  });
  add('tdd.start', z.object({ config: str, vmUrl: str, deviceId: str, target: str, projectId: str, flutterArgs: z.array(z.string()).optional(),
    mode: z.enum(['run', 'drive']).optional(), scenario: str, statusFile: str }), async (input, context) => {
    if (input.vmUrl && input.deviceId) throw new CliError('INVALID_INPUT', 'Choose vmUrl or deviceId.', 2);
    if (input.scenario) { const config = await loadConfig(context.cwd); new ScenarioResolver(config.scenarios ?? {}).resolve(input.scenario); }
    const configRoot = input.config ? resolve(context.cwd, input.config) : context.cwd;
    const sharedConfig = await resolveProjectConfig(extname(configRoot) ? dirname(configRoot) : configRoot);
    const vmServiceUrl = input.vmUrl ?? (!input.deviceId ? host!.status().endpoint : undefined);
    const result = await host!.startRuntime({ configRoot, vmServiceUrl, sharedConfig,
      app: input.deviceId ? { deviceId: input.deviceId, target: input.target, projectId: input.projectId ?? context.cwd, flutterArgs: input.flutterArgs, mode: input.mode } : undefined,
      launchMode: vmServiceUrl ? 'attach' : 'start', defaultScenario: input.scenario, statusFilePath: input.statusFile ?? defaultStatusFilePath(configRoot) });
    return result;
  });
  add('tdd.status', z.object({}), (_input, context) => host ? host.status() : tddStatusCommand({ configRoot: context.cwd, print: false }), false);
  add('tdd.focus', z.object({ file: z.string().min(1), testName: str }), async (input, context) => {
    await host!.getRuntime().focus(resolve(context.cwd, input.file), input.testName);
    return host!.getRuntime().snapshot();
  });
  const runCycle = async (input: any) => {
    const data = await host!.getRuntime().cycle(input.testName, input);
    if (data.status !== 'green') throw new CliError('TEST_FAILED', 'Focused cycle is red.', 1, data);
    return data;
  };
  add('tdd.cycle', z.object({ ...cycle, file: str, vmUrl: str, deviceId: str, target: str,
    flutterArgs: z.array(z.string()).optional(), scenario: str, keepAppAlive: bool }), async (input, context) => {
    if (host) return runCycle(input);
    if (!input.file) throw new CliError('INVALID_INPUT', 'Finite cycle requires --file; use --session for persistent focus.', 2);
    const config = await resolveProjectConfig(context.cwd);
    const { result } = await tddCycleCommand({ ...input, configRoot: context.cwd,
      vmUrl: input.vmUrl ?? (!input.deviceId ? config.vmServiceUrl : undefined),
      projectId: context.cwd, print: false, signal: context.signal });
    if (result.status !== 'green') throw new CliError('TEST_FAILED', 'Focused cycle is red.', 1, result);
    return result;
  }, false);
  add('tdd.reconnect', z.object({}), () => host!.reconnectRuntime());
  add('tdd.sync', z.object({ mode: z.enum(['none', 'reload', 'restart']), vmUrl: str, deviceId: str, target: str, keepAppAlive: bool }), (input, context) => host ? host.getRuntime().syncApp(input.mode) : tddSyncCommand({ ...input, sync: input.mode, mode: undefined, configRoot: context.cwd, print: false, signal: context.signal }), false);
  add('tdd.scenario', z.object({ name: z.string().min(1) }), async (input, context) => {
    const config = await loadConfig(context.cwd);
    new ScenarioResolver(config.scenarios ?? {}).resolve(input.name);
    return host!.getRuntime().setDefaultScenario(input.name);
  });
  add('tdd.stop', z.object({ keepAppAlive: bool }), (input) => host!.stopRuntime(input.keepAppAlive));
}
