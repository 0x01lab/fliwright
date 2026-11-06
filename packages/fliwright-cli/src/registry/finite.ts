import { resolve } from 'node:path';
import { generateTestCommand } from '../commands/generate-test.js';
import { GenerateTestParamsSchema } from './generation-schema.js';
import { waitForVmServiceEndpoint } from '@fliwright/core';
import { z } from 'zod';
import { FlutterDaemonController, SubprocessDaemonTransport } from '@fliwright/tdd';
import { CommandRegistry, CliError, type CommandContext } from '../CommandRegistry.js';
import { collectCatalog } from '../catalog.js';
import { loadConfig } from '../config.js';
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
import { artifactsReportCommand } from '../commands/artifact-report.js';
import { releaseMetadataSchema } from '../ReleaseReview.js';
import { mockStartCommand } from '../commands/mock.js';
import type { AppSessionDeps } from '../capabilities/session.js';
import { prepareNativeRun, type ManagedNativeRun } from '../ManagedNativeRun.js';
import { startManagedAppControl } from '../ManagedAppRun.js';

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
  registry.add({ path: 'generate-test', description: 'Generate a test draft from source or snapshot',
    input: GenerateTestParamsSchema, effects: ['filesystem-write'],
    execute: (input, context) => generateTestCommand({ ...input,
      outputFile: input.outputFile ? resolve(context.cwd, input.outputFile) : undefined }) });
  add('schema', { path: str }, (input) => registry.schema(input.path), [], { positional: ['path'] });
  add('init', { install: bool, node: bool, flutter: bool, pm: z.enum(['npm', 'pnpm', 'yarn', 'bun']).optional(), agent: z.enum(['codex']).optional(), yes: bool, entrypoint: str }, (input, context) => initCommand(context.cwd, { ...input, packageManager: input.pm }, { log: console.error, signal: context.signal }), ['project-files', 'dependency-install']);
  add('doctor', { ...connection, strict: bool }, async (input, context) => {
    const checks = await doctorCommand(context.cwd, { vmServiceUrl: input.vmUrl, print: false, signal: context.signal });
    const optional = new Set(['Riverpod observer', 'Mock server']);
    const data = { checks: checks.map((check) => ({ ...check, required: !optional.has(check.name), status: check.passed ? 'passed' : check.message.startsWith('skipped') ? 'skipped' : 'failed' })) };
    if (input.strict && data.checks.some((check) => check.required && check.status !== 'passed')) throw new CliError('ENVIRONMENT_INVALID', 'Required environment checks failed.', 3, data);
    return data;
  }, ['environment-probe']);
  add('catalog', { suites: z.record(z.string().min(1)).optional() }, async (input, context) => {
    const config = await loadConfig(context.cwd);
    return collectCatalog({ cwd: context.cwd, suites: input.suites ?? config.suites ?? { tests: `${config.testDir}/**/*.test.ts` } });
  }, ['trusted-project-import'], { description: 'Collect test catalog without running test or hook bodies', needsApp: false });
  const runFields = { deviceId: str, target: str, flutterArgs: z.array(z.string()).optional(), keepAppAlive: bool, test: str, testName: str, caseSelection: z.object({ caseId: z.string().regex(/^[a-f0-9]{64}$/), file: z.string().min(1), titlePath: z.array(z.string()).min(1), duplicateIndex: z.number().int().nonnegative() }).strict().optional(), ...connection, reporter: z.enum(['pretty', 'json', 'junit']).optional(), timeout: positive,
    screenshot: z.enum(['file', 'base64', 'off']).optional(), recordingMode: z.enum(['standard', 'full', 'off']).optional(),
    output: str, junitOutput: str, runsRoot: str, scenario: str, release: releaseMetadataSchema.optional() };
  const run = async (input: any, context: CommandContext) => {
    if (input.vmUrl && input.deviceId) throw new CliError('INVALID_INPUT', 'Choose vmUrl or deviceId.', 2);
    let daemon = input.deviceId ? new FlutterDaemonController(new SubprocessDaemonTransport()) : undefined;
    let appId: string | undefined;
    let nativeRun: ManagedNativeRun | undefined;
    let managedApp: Awaited<ReturnType<typeof startManagedAppControl>> | undefined;
    const abortLaunch = () => { void daemon?.dispose(); };
    context.signal.addEventListener('abort', abortLaunch, { once: true });
    try {
      context.signal.throwIfAborted();
      let vmUrl = input.vmUrl;
      if (daemon) {
        nativeRun = await prepareNativeRun(context.cwd, { deviceId: input.deviceId, signal: context.signal, scenario: input.scenario,
          launch: { target: input.target, flutterArgs: input.flutterArgs, keepAppAlive: input.keepAppAlive } });
        if (nativeRun?.managedAppControl) {
          await daemon.dispose(); daemon = undefined;
        }
        else if (nativeRun) managedApp = await startManagedAppControl(context.cwd, { signal: context.signal,
          prepareDevice: (request, signal) => nativeRun!.prepareAttempt(request, signal),
          cancel: async () => { await daemon?.dispose(); },
          async stop(signal) {
            signal.throwIfAborted();
            if (appId) await daemon!.stop(appId);
            await daemon!.dispose();
            appId = undefined;
          },
          async launch(signal, _request, reportPhase) {
            signal.throwIfAborted();
            daemon = new FlutterDaemonController(new SubprocessDaemonTransport());
            await daemon.start();
            signal.throwIfAborted();
            const next = await daemon.startApp({ deviceId: input.deviceId, target: input.target, projectId: context.cwd, flutterArgs: input.flutterArgs },
              { debugPortTimeoutMs: 120000 });
            appId = next.appId;
            reportPhase('verify-endpoint');
            await waitForVmServiceEndpoint({ url: next.wsUri, kind: 'direct-vm', source: 'managed-relaunch', scope: 'execution-worker', acquiredAt: new Date().toISOString() }, { signal });
            return { url: next.wsUri };
          },
        });
        else {
          await daemon.start();
          const app = await daemon.startApp({ deviceId: input.deviceId, target: input.target, projectId: context.cwd, flutterArgs: input.flutterArgs });
          appId = app.appId; vmUrl = app.wsUri;
          await waitForVmServiceEndpoint({ url: vmUrl, kind: 'direct-vm', source: 'managed-launch', scope: 'execution-worker', acquiredAt: new Date().toISOString() }, { signal: context.signal });
        }
      }
      const data = await runCommand({ ...input, vmUrl, nativeDelegation: nativeRun?.delegation, managedAppControl: nativeRun?.managedAppControl ?? managedApp?.control, testPattern: input.test, scenarioMode: input.deviceId ? 'managed-start' : 'attach', cwd: context.cwd, signal: context.signal, print: false });
      if (!data.passed) throw new CliError(data.runnerErrors?.length ? 'RUNNER_FAILED' : 'TEST_FAILED', 'Run did not pass.', data.runnerErrors?.length ? 3 : 1, data);
      return data;
    } finally {
      context.signal.removeEventListener('abort', abortLaunch);
      let cleanupConfirmed = false;
      try {
        try { await managedApp?.dispose(); }
        finally {
          try { if (daemon && appId && !input.keepAppAlive) await daemon.stop(appId); }
          finally { await daemon?.dispose({ keepAppAlive: input.keepAppAlive }); }
        }
        cleanupConfirmed = true;
      } finally { await nativeRun?.dispose({ cleanupConfirmed }); }
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
  add('app.screenshot', { ...connection, output: str, pixelRatio: z.number().finite().positive().optional(), fullPage: bool, scrollable: str, maxHeight: z.number().finite().positive().optional() }, withContext(appScreenshotCommand), ['image-file'], { needsApp: true });
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
  add('artifacts.report', { ...artifact, output: str, review: str, plan: str, release: releaseMetadataSchema.optional(), requireQualified: bool }, async (input, context) => {
    const data = await artifactsReportCommand({ ...input, cwd: context.cwd, signal: context.signal });
    if (input.requireQualified && !data.releaseReady) throw new CliError('RELEASE_NOT_QUALIFIED', 'Release tests did not qualify.', 1, data);
    return data;
  }, ['html-report'], { positional: ['runId'], description: 'Generate an offline release test review report' });
  add('artifacts.failures', { ...artifact, testName: str }, withContext(artifacts.artifactsFailuresCommand), [], { positional: ['runId'] });
  const timeline = { ...artifact, path: str, testId: str, attemptId: str, nodeId: str, includeArtifacts: bool, includeFlow: bool };
  add('artifacts.timeline', timeline, withContext(artifacts.artifactsTimelineCommand), [], { positional: ['runId'] });
  add('artifacts.diagnose', { ...timeline, failureIndex: z.number().int().min(0).optional(), failure: z.object({ code: z.string(), title: z.string(), message: z.string(), timelineNodeId: str }).optional() }, withContext(artifacts.artifactsDiagnoseCommand), ['optional-ai'], { positional: ['runId'] });
}
