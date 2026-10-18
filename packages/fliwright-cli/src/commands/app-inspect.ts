import { inspectionOutput } from '../InspectionOutput.js';
import { artifactsFailuresCommand } from './artifact-query.js';
import { tddStatusCommand } from './tdd.js';
import { mockListCommand } from './mock-management.js';
import { CliError } from '../CommandRegistry.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { diagnosticsInteraction, findInteraction, hotReloadAndSnapInteraction, snapInteraction } from '../capabilities/interaction.js';
import { withAppSession, type AppSessionOptions, type AppSessionDeps } from '../capabilities/session.js';

export async function appSnapshotCommand(options: AppSessionOptions & { depth?: number; includeRects?: boolean; includeProperties?: boolean }, deps: AppSessionDeps = {}) {
  return withAppSession(options, ({ driver }) => snapInteraction(driver, options), deps);
}
export async function appFindCommand(options: AppSessionOptions & Parameters<typeof findInteraction>[1], deps: AppSessionDeps = {}) {
  return withAppSession(options, ({ driver }) => findInteraction(driver, options), deps);
}
export async function appSourceMapCommand(options: AppSessionOptions & { includeFramework?: boolean; includeRects?: boolean; includeProperties?: boolean; limit?: number }, deps: AppSessionDeps = {}) {
  return withAppSession(options, ({ driver }) => driver.page.sourceMap(options), deps);
}
export async function appDiagnosticsCommand(options: AppSessionOptions & Parameters<typeof diagnosticsInteraction>[1], deps: AppSessionDeps = {}) {
  return withAppSession(options, ({ driver }) => diagnosticsInteraction(driver, options), deps);
}
export async function appReloadCommand(options: AppSessionOptions & { depth?: number; includeRects?: boolean; includeProperties?: boolean; includeScreenshot?: boolean; screenshotPixelRatio?: number; output?: string }, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    const result = await hotReloadAndSnapInteraction(driver, { ...options, pixelRatio: options.screenshotPixelRatio, includeScreenshot: options.includeScreenshot ?? false });
    const { screenshot: base64, ...data } = result;
    let screenshot: { path: string } | undefined;
    if (base64) {
      const path = await inspectionOutput(options, 'reload');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(base64, 'base64'));
      screenshot = { path };
    }
    if (!result.reloaded || result.exceptions.length) throw new CliError('RELOAD_FAILED', 'Hot reload or capture failed.', 3, { ...data, screenshot });
    return { ...data, screenshot };
  }, deps);
}
export async function appDebugSnapshotCommand(options: AppSessionOptions & {
  depth?: number; includeRects?: boolean; includeProperties?: boolean; includeScreenshot?: boolean; pixelRatio?: number;
  includeDiagnostics?: boolean; diagnosticLimit?: number; includeMockStatus?: boolean; mockRecentCallsLimit?: number;
  includeSourceMap?: boolean; sourceMapLimit?: number; output?: string;
}, deps: AppSessionDeps = {}) {
  return withAppSession(options, async ({ driver }) => {
    const errors: Array<{ section: string; message: string }> = [];
    async function section<T>(name: string, execute: () => Promise<T>): Promise<T | undefined> {
      try { return await execute(); } catch (error) { errors.push({ section: name, message: error instanceof Error ? error.message : String(error) }); return undefined; }
    }
    // A structural snapshot is required; optional channels can fail independently.
    const snapshot = await driver.page.snapshot(options);
    if (snapshot.error) throw new Error(snapshot.error);
    const context = await section('context', () => driver.page.context());
    const diagnostics = options.includeDiagnostics !== false ? await section('diagnostics', () => diagnosticsInteraction(driver, { limit: options.diagnosticLimit ?? 20 })) : undefined;
    const mock = options.includeMockStatus !== false ? await section('mock', async () => ({
      rules: (await mockListCommand(options)).rules, routes: await driver.mock.listFlutterRoutes(), calls: (await driver.mock.getFlutterCalls()).slice(-(options.mockRecentCallsLimit ?? 20)),
    })) : undefined;
    const sourceMap = options.includeSourceMap ? await section('sourceMap', () => driver.page.sourceMap({ ...options, limit: options.sourceMapLimit })) : undefined;
    const screenshot = options.includeScreenshot ? await section('screenshot', async () => {
      const path = await inspectionOutput(options, 'debug');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, await driver.page.screenshot({ pixelRatio: options.pixelRatio }));
      return { path, mimeType: 'image/png' };
    }) : undefined;
    const lastFailures = await section('failures', async () => (await artifactsFailuresCommand({ cwd: options.cwd })).failures);
    const tdd = await tddStatusCommand({ configRoot: options.cwd ?? process.cwd(), print: false });
    return { lastFailures, tdd, connected: true, capturedAt: new Date().toISOString(), ...context, snapshot, diagnostics, mock, sourceMap, screenshot, partial: errors.length > 0, errors };
  }, deps);
}
