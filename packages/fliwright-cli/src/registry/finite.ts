import { waitForVmServiceEndpoint } from '@fliwright/core';
import { z } from 'zod';
import { FlutterDaemonController, SubprocessDaemonTransport } from '@fliwright/tdd';
import { CommandRegistry, CliError, type CommandContext } from '../CommandRegistry.js';
import { runCommand } from '../commands/run.js';
import { initCommand } from '../commands/init.js';
import { doctorCommand } from '../commands/doctor.js';
import { recordCommand } from '../commands/record.js';
import { appStatusCommand, appObserveCommand, appInteractCommand, appScreenshotCommand } from '../commands/app.js';
import * as inspect from '../commands/app-inspect.js';
import { scenarioListCommand, scenarioResolveCommand, scenarioApplyCommand } from '../commands/scenario.js';
import * as mocks from '../commands/mock-management.js';
import { artifactsShowCommand, artifactsExportCommand } from '../commands/artifacts.js';
import * as artifacts from '../commands/artifact-query.js';
import { mockStartCommand } from '../commands/mock.js';
import type { AppSessionDeps } from '../capabilities/session.js';

export const str = z.string().min(1).optional();
export const bool = z.boolean().optional();
export const positive = z.number().int().positive().optional();
export const number = z.number().finite().optional();
export const target = { ref: str, key: str, text: str, type: str };
export const snapshot = { depth: positive, includeRects: bool, includeProperties: bool };
export const diagnostics = { listen: bool, clear: bool, limit: positive, kinds: z.array(z.string()).optional(), streams: z.array(z.string()).optional() };
export const connection = { vmUrl: str };
export const artifact = { runId: str, runsRoot: str, allowPartial: bool };
export const actionNames = ['doubleClick', 'tripleClick', 'rightClick', 'hover', 'focus', 'blur', 'clear', 'pressKey', 'setCheckbox', 'selectOption', 'drag', 'dismissModal', 'dismissKeyboard', 'waitForNetworkIdle'] as const;
export interface FiniteDeps { app?: AppSessionDeps; }
export function registerFinite(registry: CommandRegistry, deps: FiniteDeps = {}): void {
  const add = (path: string, input: z.ZodRawShape, execute: (input: any, context: CommandContext) => unknown, effects: string[] = [], extra: Partial<Parameters<CommandRegistry['add']>[0]> = {}) =>
    registry.add({ path, input: z.object(input), execute, effects, description: path.replaceAll('.', ' '), ...extra });
  const withContext = (fn: (options: any, deps?: AppSessionDeps) => unknown) => (input: any, context: CommandContext) => fn({ ...input, cwd: context.cwd, signal: context.signal }, deps.app);
  add('schema', { path: str }, (input) => registry.schema(input.path), [], { positional: ['path'] });
  add('init', { install: bool, node: bool, flutter: bool, pm: z.enum(['npm', 'pnpm', 'yarn', 'bun']).optional() }, (input, context) => initCommand(context.cwd, { ...input, packageManager: input.pm }, { log: console.error }), ['project-files', 'dependency-install']);
  add('doctor', { ...connection, strict: bool }, async (input, context) => {
    const checks = await doctorCommand(context.cwd, { vmServiceUrl: input.vmUrl, print: false, signal: context.signal });
    const optional = new Set(['Riverpod observer', 'Mock server']);
    const data = { checks: checks.map((check) => ({ ...check, required: !optional.has(check.name), status: check.passed ? 'passed' : check.message.startsWith('skipped') ? 'skipped' : 'failed' })) };
    if (input.strict && data.checks.some((check) => check.required && check.status !== 'passed')) throw new CliError('ENVIRONMENT_INVALID', 'Required environment checks failed.', 3, data);
    return data;
  }, ['environment-probe']);
  const runFields = { deviceId: str, target: str, flutterArgs: z.array(z.string()).optional(), keepAppAlive: bool, test: str, testName: str, ...connection, reporter: z.enum(['pretty', 'json', 'junit']).optional(), timeout: positive,
    screenshot: z.enum(['file', 'base64', 'off']).optional(), recordingMode: z.enum(['standard', 'full', 'off']).optional(),
    output: str, junitOutput: str, runsRoot: str, scenario: str };
  const run = async (input: any, context: CommandContext) => {
    if (input.vmUrl && input.deviceId) throw new CliError('INVALID_INPUT', 'Choose vmUrl or deviceId.', 2);
    const daemon = input.deviceId ? new FlutterDaemonController(new SubprocessDaemonTransport()) : undefined;
    let appId: string | undefined;
    const abortLaunch = () => { void daemon?.dispose(); };
    context.signal.addEventListener('abort', abortLaunch, { once: true });
    try {
      context.signal.throwIfAborted();
      let vmUrl = input.vmUrl;
      if (daemon) {
        await daemon.start();
        const app = await daemon.startApp({ deviceId: input.deviceId, target: input.target, projectId: context.cwd, flutterArgs: input.flutterArgs });
        appId = app.appId; vmUrl = app.wsUri;
        await waitForVmServiceEndpoint({ url: vmUrl, kind: 'direct-vm', source: 'managed-launch', scope: 'execution-worker', acquiredAt: new Date().toISOString() }, { signal: context.signal });
      }
      const data = await runCommand({ ...input, vmUrl, testPattern: input.test, scenarioMode: daemon ? 'managed-start' : 'attach', cwd: context.cwd, signal: context.signal, print: false });
      if (!data.passed) throw new CliError(data.runnerErrors?.length ? 'RUNNER_FAILED' : 'TEST_FAILED', 'Run did not pass.', data.runnerErrors?.length ? 3 : 1, data);
      return data;
    } finally {
      context.signal.removeEventListener('abort', abortLaunch);
      try { if (daemon && appId && !input.keepAppAlive) await daemon.stop(appId); }
      finally { await daemon?.dispose({ keepAppAlive: input.keepAppAlive }); }
    }
  };
  add('run', runFields, run, ['app', 'run-artifacts'], { needsApp: true, output: 'CliRunResult' });
  add('script', { ...runFields, file: z.string().min(1) }, (input, context) => run({ ...input, test: input.file }, context), ['app', 'run-artifacts'], { positional: ['file'], needsApp: true, output: 'CliRunResult' });
  add('record', { ...connection, output: str, flowOutput: str, lang: z.enum(['ts', 'dart']).optional(), mode: z.enum(['script', 'test']).optional(),
    scenario: str, assertions: str, verify: bool, name: str, homeRoute: str, resetHome: bool, duration: z.number().finite().positive().optional(),
    dartAppEntrypoint: str, dartVerification: str }, (input, context) => recordCommand({ ...input, cwd: context.cwd, signal: context.signal,
      testName: input.name, durationMs: input.duration === undefined ? undefined : input.duration * 1000, resetToHomeBeforeEach: input.resetHome,
      dartVerificationFile: input.dartVerification, print: false }, { waitForStop: context.waitForInterrupt }), ['app', 'recording-artifacts', 'generated-files'], { needsApp: true });
  add('app.status', connection, withContext(appStatusCommand), [], { needsApp: true });
  add('app.observe', { ...connection, intent: str, roles: str, limit: positive, includeDiagnostics: bool }, withContext(appObserveCommand), ['snapshot-refs'], { needsApp: true });
  add('app.snapshot', { ...connection, ...snapshot }, withContext(inspect.appSnapshotCommand), ['snapshot-refs'], { needsApp: true });
  add('app.find', { ...connection, text: str, containsText: str, key: str, semanticsLabel: str, role: str, type: str }, withContext(inspect.appFindCommand), ['snapshot-refs'], { needsApp: true });
  add('app.source-map', { ...connection, ...snapshot, includeFramework: bool, limit: positive }, withContext(inspect.appSourceMapCommand), [], { needsApp: true });
  add('app.diagnostics', { ...connection, ...diagnostics }, withContext(inspect.appDiagnosticsCommand), ['diagnostic-subscriptions'], { needsApp: true });
  add('app.reload', { ...connection, ...snapshot, includeScreenshot: bool, screenshotPixelRatio: number }, withContext(inspect.appReloadCommand), ['app-reload', 'snapshot-refs'], { needsApp: true });
  add('app.screenshot', { ...connection, output: str, pixelRatio: z.number().finite().positive().optional() }, withContext(appScreenshotCommand), ['image-file'], { needsApp: true });
  add('app.debug-snapshot', { ...connection, ...snapshot, output: str, includeScreenshot: bool, pixelRatio: z.number().positive().optional(), includeDiagnostics: bool,
    diagnosticLimit: positive, includeMockStatus: bool, mockRecentCallsLimit: positive, includeSourceMap: bool, sourceMapLimit: positive }, withContext(inspect.appDebugSnapshotCommand), ['snapshot-refs', 'optional-image-file'], { needsApp: true });
  add('app.interact', { ...connection, ...target, operation: z.enum(['tap', 'type', 'navigate', 'wait', 'drag', 'action']), value: z.union([z.string(), z.number()]).optional(),
    replace: bool, path: str, homeRoute: str, navigationAction: z.enum(['goto', 'resetRouteStack', 'resetToHome']).optional(), timeout: positive,
    deltaX: number, deltaY: number, steps: positive, x: number, y: number, action: z.enum(actionNames).optional(), keyboardKey: str,
    checked: bool, includeSnapshot: bool, quietMs: positive, extra: z.record(z.unknown()).optional(), waitUntil: z.enum(['none', 'settled']).optional(),
    settleTimeout: positive, stableFrames: positive, waitFor: z.record(z.unknown()).optional(), waitForTimeout: positive, throwOnSettleTimeout: bool }, withContext(appInteractCommand), ['app'], { positional: ['operation'], needsApp: true });
  add('scenario.list', {}, withContext(scenarioListCommand));
  add('scenario.resolve', { name: z.string().min(1) }, withContext(scenarioResolveCommand), [], { positional: ['name'] });
  add('scenario.apply', { ...connection, name: z.string().min(1) }, withContext(scenarioApplyCommand), ['app-state'], { positional: ['name'], needsApp: true });
  add('scenario.reset', { ...connection, name: z.string().min(1) }, withContext(scenarioApplyCommand), ['app-state'], { positional: ['name'], needsApp: true });
  const mockFields = { ...connection, mockDir: str, endpoint: str, method: str };
  add('mock.list', { mockDir: str }, withContext(mocks.mockListCommand));
  add('mock.status', mockFields, withContext(mocks.mockStatusCommand), [], { needsApp: true });
  add('mock.calls', mockFields, withContext(mocks.mockCallsCommand), [], { needsApp: true });
  add('mock.apply', { ...mockFields, endpoint: z.string().min(1), ruleName: z.string().min(1) }, withContext(mocks.mockApplyCommand), ['mock-routes'], { positional: ['endpoint', 'ruleName'], needsApp: true });
  add('mock.clear-calls', connection, withContext(mocks.mockClearCallsCommand), ['mock-history'], { needsApp: true });
  add('mock.reset', connection, withContext(mocks.mockClearCommand), ['mock-routes', 'mock-history', 'passthrough'], { needsApp: true });
  add('mock.start', { host: str, port: z.number().int().min(0).max(65535).optional(), mockDir: str }, (input, context) => mockStartCommand({ ...input, cwd: context.cwd, signal: context.signal }), ['local-http-listener']);
  add('artifacts.show', artifact, withContext(artifactsShowCommand), [], { positional: ['runId'] });
  add('artifacts.export', { ...artifact, output: z.string().min(1) }, withContext(artifactsExportCommand), ['export-files'], { positional: ['runId'] });
  add('artifacts.failures', { ...artifact, testName: str }, withContext(artifacts.artifactsFailuresCommand), [], { positional: ['runId'] });
  const timeline = { ...artifact, path: str, testId: str, attemptId: str, nodeId: str, includeArtifacts: bool, includeFlow: bool };
  add('artifacts.timeline', timeline, withContext(artifacts.artifactsTimelineCommand), [], { positional: ['runId'] });
  add('artifacts.diagnose', { ...timeline, failureIndex: z.number().int().min(0).optional(), failure: z.object({ code: z.string(), title: z.string(), message: z.string(), timelineNodeId: str }).optional() }, withContext(artifacts.artifactsDiagnoseCommand), ['optional-ai'], { positional: ['runId'] });
}
