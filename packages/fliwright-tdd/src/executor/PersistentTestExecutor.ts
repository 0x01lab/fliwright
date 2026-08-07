import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { FLIWRIGHT_RUNS_ROOT_ENV } from '@fliwright/core';
import { startVitest, type Vitest } from 'vitest/node';
import { focusAndRerun } from './FocusedRerunRecipe.js';
import { ResultReporter, type CollectedResult } from './ResultReporter.js';
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
  artifactsRoot?: string;
}

export class PersistentTestExecutor {
  private vitest?: Vitest;
  private reporter?: ResultReporter;
  private previousVmServiceUrl?: string;
  private previousVmUrl?: string;
  private previousTddMode?: string;
  private previousFailureContextPath?: string;
  private previousScreenshotMode?: string;
  private previousFailureTimeoutMs?: string;
  private previousRunsRoot?: string;
  private failureContextPath?: string;
  private runsRoot?: string;
  private envApplied = false;

  async boot(opts: BootOptions): Promise<void> {
    if (this.vitest) return;

    // Apply env first; if anything after it throws, restore it so the MCP host process is not
    // left with TDD env vars leaking into unrelated (batch) test runs.
    await this.applyRuntimeEnv(opts);
    try {
      this.reporter = new ResultReporter();
      this.vitest = await startVitest([], {
        config: opts.configRoot,
        watch: true,
        reporters: [this.reporter],
        pool: 'forks',
        maxWorkers: 1,
      });
      if (!this.vitest) throw new Error('Failed to start Vitest');
      await this.vitest.standalone();
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
    const nextRun = this.reporter.waitForNextRun();
    await focusAndRerun(this.vitest, file, testName);
    const files = await nextRun;
    const results = this.reporter.collectLatest();
    const picked = this.pickResult(results, testName);
    const resolvedTestName = picked?.testName ?? testName;
    const timelineArtifacts = resolvedTestName
      ? await this.readLatestTimelineArtifacts(resolvedTestName)
      : {};
    const failureDetails = picked?.status === 'red' && resolvedTestName
      ? await this.readFailureDetails(resolvedTestName)
      : undefined;

    return {
      status: picked?.status ?? this.statusFromUnhandled(files),
      testName: resolvedTestName,
      failure: picked?.status === 'red' ? { message: picked.message } : undefined,
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

  private statusFromUnhandled(files: unknown[]): 'red' | 'green' {
    return files.length > 0 ? 'red' : 'green';
  }

  private restoreRuntimeEnv(): void {
    restoreEnv('FLIWRIGHT_VM_SERVICE_URL', this.previousVmServiceUrl);
    restoreEnv('FLIWRIGHT_VM_URL', this.previousVmUrl);
    restoreEnv('FLIWRIGHT_TDD_MODE', this.previousTddMode);
    restoreEnv('FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH', this.previousFailureContextPath);
    restoreEnv('FLIWRIGHT_SCREENSHOT_MODE', this.previousScreenshotMode);
    restoreEnv('FLIWRIGHT_FAILURE_TIMEOUT_MS', this.previousFailureTimeoutMs);
    restoreEnv(FLIWRIGHT_RUNS_ROOT_ENV, this.previousRunsRoot);
    this.envApplied = false;
  }

  private async applyRuntimeEnv(opts: BootOptions): Promise<void> {
    this.snapshotPreviousEnv();
    try {
      process.env.FLIWRIGHT_TDD_MODE = '1';
      if (opts.vmServiceUrl) {
        process.env.FLIWRIGHT_VM_SERVICE_URL = opts.vmServiceUrl;
        process.env.FLIWRIGHT_VM_URL = opts.vmServiceUrl;
      }

      const artifactsRoot = opts.artifactsRoot ?? defaultArtifactsRoot(opts.configRoot);
      await mkdir(artifactsRoot, { recursive: true });
      this.failureContextPath = join(artifactsRoot, 'failures.json');
      this.runsRoot = join(artifactsRoot, 'runs');
      await writeFile(this.failureContextPath, '[]', 'utf8');
      process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH = this.failureContextPath;
      process.env[FLIWRIGHT_RUNS_ROOT_ENV] = this.runsRoot;
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
    this.previousVmServiceUrl = process.env.FLIWRIGHT_VM_SERVICE_URL;
    this.previousVmUrl = process.env.FLIWRIGHT_VM_URL;
    this.previousTddMode = process.env.FLIWRIGHT_TDD_MODE;
    this.previousFailureContextPath = process.env.FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH;
    this.previousScreenshotMode = process.env.FLIWRIGHT_SCREENSHOT_MODE;
    this.previousFailureTimeoutMs = process.env.FLIWRIGHT_FAILURE_TIMEOUT_MS;
    this.previousRunsRoot = process.env[FLIWRIGHT_RUNS_ROOT_ENV];
  }

  private async readFailureDetails(testName: string): Promise<TddFailureDetails | undefined> {
    if (!this.failureContextPath) return undefined;
    try {
      const entries = JSON.parse(await readFile(this.failureContextPath, 'utf8')) as McpFailureEntry[];
      const entry = [...entries].reverse().find((candidate) => candidate.testName === testName) ?? entries.at(-1);
      if (!entry) return undefined;
      return {
        assertion: entry.assertion,
        source: entry.source,
        artifacts: {
          failureContextPath: this.failureContextPath,
          screenshotBase64: entry.screenshot?.base64,
          widgetTree: entry.widgetTree,
          ...await this.readLatestTimelineArtifacts(testName),
        },
      };
    } catch {
      return undefined;
    }
  }

  private async readLatestTimelineArtifacts(testName: string): Promise<Pick<TddFailureArtifacts, 'timelinePath' | 'timelineNodeId'>> {
    if (!this.runsRoot) return {};
    try {
      const timelinePath = await findLatestTimelinePath(this.runsRoot, testName);
      if (!timelinePath) return {};
      const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as TimelineLike;
      return {
        timelinePath,
        timelineNodeId: timeline.agentVisibleFailures?.[0]?.timelineNodeId,
      };
    } catch {
      return {};
    }
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

export function defaultArtifactsRoot(configRoot: string): string {
  const root = looksLikeConfigFile(configRoot) ? resolve(configRoot, '..') : resolve(configRoot);
  return join(root, '.fliwright', 'tdd');
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

interface McpFailureEntry {
  testName: string;
  assertion?: TddFailureAssertion;
  widgetTree?: unknown;
  source?: TddFailureSource;
  screenshot?: {
    mimeType: 'image/png';
    base64: string;
  };
  timestamp: string;
}

interface TimelineLike {
  testName?: string;
  agentVisibleFailures?: Array<{ timelineNodeId?: string }>;
}

async function findLatestTimelinePath(runsRoot: string, testName: string): Promise<string | undefined> {
  const entries = await readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map(async (entry) => {
      const timelinePath = join(runsRoot, entry.name, 'timeline.json');
      try {
        const [timeline, stats] = await Promise.all([
          readTimelineHeader(timelinePath),
          stat(timelinePath),
        ]);
        const matches = timeline.testName === testName || entry.name.endsWith(`-${safeName(testName)}`);
        return matches ? { path: timelinePath, mtimeMs: stats.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    }));
  return candidates
    .filter((candidate): candidate is { path: string; mtimeMs: number } => Boolean(candidate))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .at(0)?.path;
}

async function readTimelineHeader(path: string): Promise<TimelineLike> {
  return JSON.parse(await readFile(path, 'utf8')) as TimelineLike;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'test';
}
