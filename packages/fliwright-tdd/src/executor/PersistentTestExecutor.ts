import { mkdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { FLIWRIGHT_RUNS_ROOT_ENV, RunArtifactStore, parseTimelineData, resolveFliwrightRunsRoot, resolveFliwrightCacheRoot, mergeFliwrightConfig, readFliwrightEnvironment } from '@fliwright/core';
import type { RunSessionResult } from '@fliwright/core';
import { fileURLToPath } from 'node:url';
import { startVitest, type Vitest } from 'vitest/node';
import { focusAndRerun } from './FocusedRerunRecipe.js';
import { collectResultsFromModules, ResultReporter, type CollectedResult } from './ResultReporter.js';
import type { TddFailureArtifacts, TddFailureAssertion, TddFailureSource } from '../diagnostics/TddFailureContext.js';

export interface TestRunOutcome {
  status: 'red' | 'green';
  testName?: string;
  failure?: { message?: string };
  failureDetails?: TddFailureDetails;
  timelinePath?: string;
  timelineNodeId?: string;
}

export interface BootOptions {
  configRoot: string;
  vmServiceUrl?: string;
  driverProvider: () => Promise<unknown>;
  runsRoot?: string;
  sharedConfig?: Partial<import('@fliwright/core').FliwrightProjectConfig>;
  defaultScenario?: string;
  scenarioMode?: 'managed-start' | 'attach';
}

export class PersistentTestExecutor {
  private vitest?: Vitest;
  private reporter?: ResultReporter;
  private previousDefaultScenario?: string;
  private previousScenarioMode?: string;
  private previousVmServiceUrl?: string;
  private previousVmUrl?: string;
  private previousTddMode?: string;
  private previousScreenshotMode?: string;
  private previousFailureTimeoutMs?: string;
  private previousRunsRoot?: string;
  private previousRunId?: string;
  private previousSharedConfig?: string;
  private previousProjectRoot?: string;
  private runsRoot?: string;
  private envApplied = false;

  async boot(opts: BootOptions): Promise<void> {
    if (this.vitest) return;

    // Apply env first; if anything after it throws, restore it so the CLI connection worker is not
    // left with TDD env vars leaking into unrelated (batch) test runs.
    await this.applyRuntimeEnv(opts);
    try {
      this.reporter = new ResultReporter();
      this.vitest = await startVitest('test', [], {
        config: opts.configRoot,
        watch: true,
        standalone: true,
        reporters: [this.reporter],
        pool: 'forks',
        maxWorkers: 1,
      }, {
        // macOS FSEvents can deliver a config write from before boot after a
        // focused run starts, causing Vite to close its active module cache.
        ...(process.platform === 'darwin' ? { server: { watch: { usePolling: true } } } : {}),
        plugins: [{ name: 'fliwright-runner', config(config) {
        const runtimeConfig = config as typeof config & { test?: { runner?: string } };
        (runtimeConfig.test ??= {}).runner ??= fileURLToPath(import.meta.resolve('@fliwright/vitest/runner'));
      } }] });
      if (!this.vitest) throw new Error('Failed to start Vitest');
      // A directly used executor can receive storage through the project's
      // Vitest preset. Resolve the same root the worker actually receives.
      const workerRoot = this.vitest.projects[0]?.config.env?.FLIWRIGHT_RUNS_ROOT;
      if (workerRoot) this.runsRoot = resolve(String(workerRoot));
      await mkdir(this.runsRoot!, { recursive: true });
    } catch (error) {
      await this.dispose().catch(() => undefined);
      throw error;
    }

    // The provider is kept for same-process executor experiments. Vitest workers cannot
    // receive live driver objects through process boundaries, so the production path also injects
    // FLIWRIGHT_VM_SERVICE_URL for ordinary @fliwright/vitest fixtures.
    void opts.driverProvider;
  }

  async rerun(file: string, testName?: string): Promise<TestRunOutcome> {
    if (!this.vitest || !this.reporter) throw new Error('PersistentTestExecutor not booted');

    this.reporter.drain();
    // The public API returns the exact run we requested. A reporter's next
    // event may instead belong to a watcher refresh (or contain no modules).
    const run = await focusAndRerun(this.vitest, file, testName);
    const files = run.testModules;
    const results = collectResultsFromModules(files);
    const picked = this.pickResult(results, testName);
    const resolvedTestName = picked?.testName ?? testName;
    const timelineArtifacts = await this.readTimelineArtifacts(picked);
    const failureDetails = picked?.status === 'red' && resolvedTestName
      ? await this.readFailureDetails(picked)
      : undefined;

    return {
      status: picked?.status ?? 'red',
      testName: resolvedTestName,
      failure: picked?.status === 'red' ? { message: picked.message }
        : !picked ? { message: run.unhandledErrors.map((error) => {
          if (error && typeof error === 'object' && 'message' in error) return String(error.message);
          return JSON.stringify(error);
        }).join('\n') || 'Focused run returned no matching test result.' } : undefined,
      failureDetails,
      timelinePath: failureDetails?.artifacts?.timelinePath ?? timelineArtifacts.timelinePath,
      timelineNodeId: failureDetails?.artifacts?.timelineNodeId ?? timelineArtifacts.timelineNodeId,
    };
  }

  async dispose(): Promise<void> {
    try {
      await this.vitest?.close();
    } finally {
      this.vitest = undefined;
      this.reporter = undefined;
      if (this.envApplied) this.restoreRuntimeEnv();
    }
  }

  private pickResult(results: CollectedResult[], testName?: string): CollectedResult | undefined {
    if (!testName) return results.find((result) => result.status === 'red') ?? results[0];
    return results.find((result) => result.testName === testName)
      ?? results.find((result) => result.testName.includes(testName));
  }

  private restoreRuntimeEnv(): void {
    restoreEnv('FLIWRIGHT_SCENARIO_MODE', this.previousScenarioMode);
    restoreEnv('FLIWRIGHT_DEFAULT_SCENARIO', this.previousDefaultScenario);
    restoreEnv('FLIWRIGHT_VM_SERVICE_URL', this.previousVmServiceUrl);
    restoreEnv('FLIWRIGHT_VM_URL', this.previousVmUrl);
    restoreEnv('FLIWRIGHT_TDD_MODE', this.previousTddMode);
    restoreEnv('FLIWRIGHT_SCREENSHOT_MODE', this.previousScreenshotMode);
    restoreEnv('FLIWRIGHT_FAILURE_TIMEOUT_MS', this.previousFailureTimeoutMs);
    restoreEnv(FLIWRIGHT_RUNS_ROOT_ENV, this.previousRunsRoot);
    restoreEnv('FLIWRIGHT_RUN_ID', this.previousRunId);
    restoreEnv('FLIWRIGHT_CONFIG', this.previousSharedConfig);
    restoreEnv('FLIWRIGHT_PROJECT_ROOT', this.previousProjectRoot);
    this.envApplied = false;
  }

  private async applyRuntimeEnv(opts: BootOptions): Promise<void> {
    this.snapshotPreviousEnv();
    try {
      process.env.FLIWRIGHT_TDD_MODE = '1';
      process.env.FLIWRIGHT_SCENARIO_MODE = opts.scenarioMode ?? 'attach';
      if (opts.defaultScenario) process.env.FLIWRIGHT_DEFAULT_SCENARIO = opts.defaultScenario;
      if (opts.vmServiceUrl) {
        process.env.FLIWRIGHT_VM_SERVICE_URL = opts.vmServiceUrl;
        process.env.FLIWRIGHT_VM_URL = opts.vmServiceUrl;
      }

      const projectRoot = looksLikeConfigFile(opts.configRoot) ? resolve(opts.configRoot, '..') : resolve(opts.configRoot);
      const config = mergeFliwrightConfig({ project: opts.sharedConfig, environment: readFliwrightEnvironment(process.env), explicit: { runsRoot: opts.runsRoot } });
      this.runsRoot = resolveFliwrightRunsRoot({ projectRoot, runsRoot: config.runsRoot, env: {} });
      await mkdir(this.runsRoot, { recursive: true });
      if (opts.sharedConfig) {
        config.cacheRoot = resolveFliwrightCacheRoot({ projectRoot, cacheRoot: config.cacheRoot });
        config.runsRoot = this.runsRoot;
        process.env.FLIWRIGHT_CONFIG = JSON.stringify(config);
      }
      process.env.FLIWRIGHT_PROJECT_ROOT = projectRoot;
      if (config.runsRoot) process.env[FLIWRIGHT_RUNS_ROOT_ENV] = this.runsRoot;
      process.env.FLIWRIGHT_SCREENSHOT_MODE = process.env.FLIWRIGHT_SCREENSHOT_MODE ?? 'base64';
      process.env.FLIWRIGHT_FAILURE_TIMEOUT_MS = process.env.FLIWRIGHT_FAILURE_TIMEOUT_MS ?? '5000';
      this.envApplied = true;
    } catch (error) {
      // mkdir/writeFile can throw; restore anything we already wrote so we never leak partial env.
      this.restoreRuntimeEnv();
      throw error;
    }
  }

  private snapshotPreviousEnv(): void {
    this.previousScenarioMode = process.env.FLIWRIGHT_SCENARIO_MODE;
    this.previousDefaultScenario = process.env.FLIWRIGHT_DEFAULT_SCENARIO;
    this.previousVmServiceUrl = process.env.FLIWRIGHT_VM_SERVICE_URL;
    this.previousVmUrl = process.env.FLIWRIGHT_VM_URL;
    this.previousTddMode = process.env.FLIWRIGHT_TDD_MODE;
    this.previousScreenshotMode = process.env.FLIWRIGHT_SCREENSHOT_MODE;
    this.previousFailureTimeoutMs = process.env.FLIWRIGHT_FAILURE_TIMEOUT_MS;
    this.previousRunsRoot = process.env[FLIWRIGHT_RUNS_ROOT_ENV];
    this.previousRunId = process.env.FLIWRIGHT_RUN_ID;
    this.previousSharedConfig = process.env.FLIWRIGHT_CONFIG;
    this.previousProjectRoot = process.env.FLIWRIGHT_PROJECT_ROOT;
  }

  private attemptDirectory(result: CollectedResult | undefined): string | undefined {
    const identity = result?.runIdentity;
    if (!this.runsRoot || !identity) return undefined;
    return new RunArtifactStore({ runsRoot: this.runsRoot, runId: identity.runId })
      .attemptDir(identity.testId, identity.attemptId);
  }

  private async readFailureDetails(result: CollectedResult | undefined): Promise<TddFailureDetails | undefined> {
    const directory = this.attemptDirectory(result);
    if (!directory) return undefined;
    try {
      const attempt = JSON.parse(await readFile(join(directory, 'result.json'), 'utf8')) as RunSessionResult;
      if (!attempt.failureContextPath) return undefined;
      const failureContextPath = join(directory, attempt.failureContextPath);
      const entries = JSON.parse(await readFile(failureContextPath, 'utf8')) as FailureEntry[];
      const entry = entries.filter((candidate) => candidate.testName === result?.testName).at(-1);
      if (!entry) return undefined;
      const screenshotBase64 = entry.screenshot?.path
        ? (await readFile(join(directory, entry.screenshot.path))).toString('base64') : undefined;
      return {
        assertion: entry.assertion, source: entry.source,
        artifacts: { failureContextPath, screenshotBase64, widgetTree: entry.widgetTree,
          ...await this.readTimelineArtifacts(result) },
      };
    } catch { return undefined; }
  }

  private async readTimelineArtifacts(result: CollectedResult | undefined): Promise<Pick<TddFailureArtifacts, 'timelinePath' | 'timelineNodeId'>> {
    const directory = this.attemptDirectory(result);
    if (!directory) return {};
    try {
      const timelinePath = join(directory, 'timeline.json');
      const timeline = parseTimelineData(await readFile(timelinePath, 'utf8'));
      if (!timeline) return {};
      return { timelinePath, timelineNodeId: timeline.agentVisibleFailures?.[0]?.timelineNodeId };
    } catch { return {}; }
  }

}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function defaultArtifactsRoot(configRoot: string): string {
  const root = looksLikeConfigFile(configRoot) ? resolve(configRoot, '..') : resolve(configRoot);
  return join(root, '.fliwright', 'runs');
}

/**
 * Default RuntimeSnapshot status-file path a read-only monitor (e.g. the VS Code TDD Loop panel)
 * polls: `<projectRoot>/.fliwright/tdd-status.json`. The project root is derived from the same
 * configRoot convention as {@link defaultArtifactsRoot}.
 */
export function defaultStatusFilePath(configRoot: string): string {
  const root = looksLikeConfigFile(configRoot) ? resolve(configRoot, '..') : resolve(configRoot);
  return join(root, '.fliwright', 'tdd-status.json');
}

function looksLikeConfigFile(configRoot: string): boolean {
  const name = basename(configRoot);
  return /\.[cm]?[jt]s$/.test(name);
}

export interface TddFailureDetails {
  assertion?: TddFailureAssertion;
  source?: TddFailureSource;
  artifacts?: TddFailureArtifacts;
}

interface FailureEntry {
  testName: string;
  assertion?: TddFailureAssertion;
  widgetTree?: unknown;
  source?: TddFailureSource;
  screenshot?: {
    mimeType: 'image/png';
    path: string;
  };
  timestamp: string;
}
