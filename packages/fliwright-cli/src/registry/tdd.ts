import { z } from 'zod';
import { TddRuntime } from '@fliwright/tdd';
import { tddStatusCommand, tddSyncCommand } from '../commands/tdd.js';
import { resolve } from 'node:path';
import { ScenarioResolver } from '@fliwright/core';
import { analyzeInteractionSpecCoverage, validateInteractionSpec, DevAssistCoordinator, defaultStatusFilePath } from '@fliwright/tdd';
import { CliError, type CommandRegistry } from '../CommandRegistry.js';
import type { ConnectionHost } from '../session/ConnectionHost.js';
import { generateTestCommand } from '../commands/generate-test.js';
import { GenerateTestParamsSchema } from './generation-schema.js';
import { loadConfig } from '../config.js';
import { str, bool, positive } from './finite.js';
const cycle = { testName: str, sync: z.enum(['none', 'reload', 'restart', 'auto']).optional(), fullReset: bool,
  changes: z.array(z.string()).optional(), autoEscalate: bool, timeoutMs: positive };
const repair = z.object({ mode: z.enum(['suggest', 'safe-apply']), iterations: positive });
export function registerTdd(registry: CommandRegistry, host?: ConnectionHost): void {
  const add = (name: string, input: z.AnyZodObject, execute: (input: any, context: any) => unknown, persistent = true) => registry.add({
    path: name, description: name.replaceAll('.', ' '), input, needsSession: persistent, effects: ['tdd-workflow'],
    async execute(input, context) {
      if ((name === 'generate-test' && input.mode === 'red-first') || name === 'tdd.prepare') { const check = validateInteractionSpec(input.spec); if (!check.ok) throw new CliError('INVALID_INPUT', 'Invalid InteractionSpec.', 2, { issues: check.issues }); }
      if (persistent && !host) throw new CliError('SESSION_REQUIRED', 'Use --session from session open for persistent TDD.', 2);
      return execute(input, context);
    },
  });
  add('generate-test', GenerateTestParamsSchema, async (input, context) => generateTestCommand({ ...input, outputFile: input.outputFile ? resolve(context.cwd, input.outputFile) : undefined }, host ? { setTddWorkflowContext: (value) => host.setWorkflow(value) } : undefined), false);
  add('tdd.validate-spec', z.object({ spec: z.unknown() }), (input) => {
    const validation = validateInteractionSpec(input.spec);
    if (!validation.ok) throw new CliError('SPEC_INVALID', 'Interaction specification is invalid.', 1, { valid: false, issues: validation.issues });
    return { valid: true, issues: [], coverage: analyzeInteractionSpecCoverage(validation.spec) };
  }, false);
  add('tdd.start', z.object({ config: str, vmUrl: str, deviceId: str, target: str, projectId: str, flutterArgs: z.array(z.string()).optional(),
    mode: z.enum(['run', 'drive']).optional(), scenario: str, statusFile: str }), async (input, context) => {
    if (input.vmUrl && input.deviceId) throw new CliError('INVALID_INPUT', 'Choose vmUrl or deviceId.', 2);
    if (input.scenario) { const config = await loadConfig(context.cwd); new ScenarioResolver(config.scenarios ?? {}).resolve(input.scenario); }
    const configRoot = input.config ? resolve(context.cwd, input.config) : context.cwd;
    const vmServiceUrl = input.vmUrl ?? (!input.deviceId ? host!.status().endpoint : undefined);
    const result = await host!.startRuntime({ configRoot, vmServiceUrl,
      app: input.deviceId ? { deviceId: input.deviceId, target: input.target, projectId: input.projectId ?? context.cwd, flutterArgs: input.flutterArgs, mode: input.mode } : undefined,
      launchMode: vmServiceUrl ? 'attach' : 'start', defaultScenario: input.scenario, statusFilePath: input.statusFile ?? defaultStatusFilePath(configRoot) });
    return result;
  });
  add('tdd.status', z.object({}), (_input, context) => host ? host.status() : tddStatusCommand({ configRoot: context.cwd, print: false }), false);
  add('tdd.focus', z.object({ file: str, testName: str }), async (input, context) => {
    const workflow = host!.getWorkflow();
    const file = input.file ?? workflow?.testFile;
    if (!file) throw new CliError('FOCUS_REQUIRED', 'Pass file or prepare a test with outputFile.', 2);
    await host!.getRuntime().focus(resolve(context.cwd, file), input.testName ?? workflow?.testName);
    return host!.getRuntime().snapshot();
  });
  const runCycle = async (input: any) => {
    const data = await host!.getRuntime().cycle(input.testName, input);
    if (data.status !== 'green') throw new CliError('TEST_FAILED', 'Focused cycle is red.', 1, data);
    return data;
  };
  add('tdd.cycle', z.object({ ...cycle, repair: repair.optional(), file: str, vmUrl: str, deviceId: str, target: str,
    flutterArgs: z.array(z.string()).optional(), scenario: str, keepAppAlive: bool }), async (input, context) => {
    if (host) return runCycle(input);
    if (!input.file) throw new CliError('INVALID_INPUT', 'Finite cycle requires --file; use --session for persistent focus.', 2);
    const config = await loadConfig(context.cwd);
    // Resolve early, before app startup. Worker fixtures own per-attempt scenario preparation.
    if (input.scenario) new ScenarioResolver(config.scenarios ?? {}).resolve(input.scenario);
    const runtime = new TddRuntime();
    const abort = () => { void runtime.cancel(); };
    context.signal.addEventListener('abort', abort, { once: true });
    try {
      context.signal.throwIfAborted();
      await runtime.start({ configRoot: context.cwd, vmServiceUrl: input.vmUrl ?? config.vmServiceUrl,
        app: input.deviceId ? { deviceId: input.deviceId, target: input.target, projectId: context.cwd, flutterArgs: input.flutterArgs } : undefined,
        defaultScenario: input.scenario });
      await runtime.focus(resolve(context.cwd, input.file), input.testName);
      const data = await runtime.cycle(input.testName, input);
      context.signal.throwIfAborted();
      if (data.status !== 'green') throw new CliError('TEST_FAILED', 'Focused cycle is red.', 1, data);
      return data;
    } finally { context.signal.removeEventListener('abort', abort); await runtime.stop({ keepAppAlive: input.keepAppAlive ?? !input.deviceId }); }
  }, false);
  add('tdd.repair', z.object({ ...cycle, mode: z.enum(['suggest', 'safe-apply']).default('suggest'), iterations: positive }), (input) => runCycle({ ...input, repair: { mode: input.mode, iterations: input.iterations } }));
  add('tdd.reconnect', z.object({}), () => host!.reconnectRuntime());
  add('tdd.sync', z.object({ mode: z.enum(['none', 'reload', 'restart']), vmUrl: str, deviceId: str, target: str, keepAppAlive: bool }), (input, context) => host ? host.getRuntime().syncApp(input.mode) : tddSyncCommand({ ...input, sync: input.mode, mode: undefined, configRoot: context.cwd, print: false, signal: context.signal }), false);
  add('tdd.scenario', z.object({ name: z.string().min(1) }), async (input, context) => {
    const config = await loadConfig(context.cwd);
    return host!.getRuntime().setTestScenario(new ScenarioResolver(config.scenarios ?? {}).resolve(input.name));
  });
  add('tdd.stop', z.object({ keepAppAlive: bool }), (input) => host!.stopRuntime(input.keepAppAlive));
  add('tdd.prepare', GenerateTestParamsSchema.omit({ mode: true }).extend({ spec: z.unknown(), focus: z.boolean().default(true) }), async (input, context) => {
    const result = await generateTestCommand({ ...input, mode: 'red-first', outputFile: input.outputFile ? resolve(context.cwd, input.outputFile) : undefined }, { setTddWorkflowContext: (value) => host!.setWorkflow(value) });
    if (input.focus && result.testFile && host!.status().tdd) {
      await host!.getRuntime().focus(result.testFile, result.tests && result.tests.length > 1 ? undefined : result.testName);
      return { ...result, focused: host!.getRuntime().snapshot() };
    }
    return result;
  });
  add('devassist.cycle', z.object({ request: str, devAssistSessionId: str, action: z.enum(['start', 'continue', 'regenerate']).optional(), files: z.array(z.string()).optional(), baseRevision: str }), (input) => {
    if (input.action && input.action !== 'start' && !input.devAssistSessionId) throw new CliError('INVALID_INPUT', 'devAssistSessionId is required for continue/regenerate.', 2);
    return new DevAssistCoordinator({ runtime: host!.getRuntime() }).cycle(input);
  });
}
