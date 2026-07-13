// packages/fliwright-core/src/TraceCollector.ts
import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { TimelineArtifactRef } from './timeline/types.js';
import type { SendRequest } from './types.js';
import {
  TIMELINE_ARTIFACT_KIND_TRACE,
  TIMELINE_TRACE_DIR,
  TIMELINE_TRACE_FILE,
} from './timeline/constants.js';

// ── Types ─────────────────────────────────────────────────────

export interface TraceStep {
  index: number;
  action: string;
  selector: string;
  argument?: string;
  status: 'pass' | 'fail';
  durationMs: number;
  screenshotFile?: string;
  widgetTree?: object;
  error?: string;
  timestamp: string;
}

export interface TraceMeta {
  testName: string;
  runId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'passed' | 'failed';
  totalSteps: number;
  traceVersion: 1;
}

export interface TraceData {
  meta: TraceMeta;
  steps: TraceStep[];
}

export type TraceMode = 'off' | 'on-failure' | 'full';
export type TraceLayout = 'legacy' | 'run';

export interface TraceCollectorOptions {
  layout?: TraceLayout;
}

// ── TraceCollector ────────────────────────────────────────────

/**
 * Captures action metadata and screenshots during test execution.
 * Writes trace.json + step-N.png to a per-test directory.
 */
export class TraceCollector {
  private steps: TraceStep[] = [];
  private completed = false;
  private readonly layout: TraceLayout;
  private readonly traceFilePath: string;

  /** Absolute path to the test-specific trace directory */
  readonly traceDir: string;

  private constructor(
    private readonly traceRoot: string,
    private readonly testName: string,
    private readonly runId: string,
    private readonly sendRequest: SendRequest,
    private readonly mode: TraceMode,
    options: TraceCollectorOptions = {},
  ) {
    this.layout = options.layout ?? 'legacy';
    this.traceDir = this.layout === 'run'
      ? resolve(traceRoot, TIMELINE_TRACE_DIR)
      : resolve(traceRoot, runId, sanitizeTraceSegment(testName));
    this.traceFilePath = join(this.traceDir, TIMELINE_TRACE_FILE);
  }

  /**
   * Create and initialise a TraceCollector.
   * Creates the trace directory and writes initial trace.json.
   */
  static async create(
    traceRoot: string,
    testName: string,
    runId: string,
    sendRequest: SendRequest,
    mode: TraceMode,
    options: TraceCollectorOptions = {},
  ): Promise<TraceCollector> {
    const collector = new TraceCollector(traceRoot, testName, runId, sendRequest, mode, options);
    await mkdir(collector.traceDir, { recursive: true });
    await collector.writeTraceFile();
    return collector;
  }

  /**
   * Record an action that was intercepted from sendRequest.
   * Conditionally captures screenshot and widget tree.
   */
  async onAction(
    method: string,
    params: Record<string, unknown>,
    durationMs: number,
    _result: unknown,
    error?: unknown,
  ): Promise<void> {
    if (this.completed) return;

    const index = this.steps.length;
    const isFail = error != null;
    const { action, selector, argument } = parseActionCall(method, params);

    const step: TraceStep = {
      index,
      action,
      selector,
      argument,
      status: isFail ? 'fail' : 'pass',
      durationMs,
      timestamp: new Date().toISOString(),
    };

    if (isFail) {
      step.error = error instanceof Error ? error.message : String(error);
    }

    // Capture screenshot: full mode → always, on-failure → only on fail
    const shouldScreenshot =
      this.mode === 'full' || (this.mode === 'on-failure' && isFail);

    if (shouldScreenshot) {
      try {
        const png = await this.captureScreenshot();
        if (png) {
          const filename = `step-${index}.png`;
          await writeFile(join(this.traceDir, filename), png);
          step.screenshotFile = filename;
        }
      } catch {
        // Screenshot failure should not affect test
      }
    }

    // Capture widget tree only on failure
    if (isFail) {
      try {
        step.widgetTree = await this.captureWidgetTree() ?? undefined;
      } catch {
        // Non-critical
      }
    }

    this.steps.push(step);
    await this.writeTraceFile();
  }

  /**
   * Finalise the trace with the overall test status.
   */
  async complete(status: 'passed' | 'failed'): Promise<void> {
    if (this.completed) return;
    this.completed = true;
    this.meta.status = status;
    this.meta.completedAt = new Date().toISOString();
    this.meta.totalSteps = this.steps.length;
    await this.writeTraceFile();
  }

  artifactRef(baseDir = this.traceRoot): TimelineArtifactRef {
    return {
      kind: TIMELINE_ARTIFACT_KIND_TRACE,
      path: relative(baseDir, this.traceFilePath).replace(/\\/g, '/'),
      mimeType: 'application/json',
      metadata: {
        layout: this.layout,
        mode: this.mode,
        totalSteps: this.steps.length,
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────

  private get meta(): TraceMeta {
    return {
      testName: this.testName,
      runId: this.runId,
      startedAt: this._startedAt,
      status: 'running',
      totalSteps: 0,
      traceVersion: 1,
    };
  }

  private _startedAt: string = new Date().toISOString();

  private buildData(): TraceData {
    const meta: TraceMeta = {
      testName: this.testName,
      runId: this.runId,
      startedAt: this._startedAt,
      completedAt: this.completed ? new Date().toISOString() : undefined,
      status: this.completed ? (this.steps.some(s => s.status === 'fail') ? 'failed' : 'passed') : 'running',
      totalSteps: this.steps.length,
      traceVersion: 1,
    };
    return { meta, steps: [...this.steps] };
  }

  private async writeTraceFile(): Promise<void> {
    const data = this.buildData();
    await writeFile(
      this.traceFilePath,
      JSON.stringify(data, null, 2),
    );
  }

  private async captureScreenshot(): Promise<Buffer | null> {
    try {
      const result = await this.sendRequest('ext.fliwright.screenshot', { pixelRatio: '1.0' }) as {
        success?: boolean;
        screenshot?: string;
        error?: string;
      };
      if (result?.screenshot) {
        return Buffer.from(result.screenshot, 'base64');
      }
    } catch { /* fall through */ }

    return null;
  }

  private async captureWidgetTree(): Promise<object | null> {
    try {
      return (await this.sendRequest('ext.fliwright.snapshot', {})) as object;
    } catch { /* fall through */ }
    try {
      return (await this.sendRequest('ext.fliwright.inspect', { selector: '' })) as object;
    } catch { /* fall through */ }
    return null;
  }
}

function sanitizeTraceSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

// ── Parsing helpers ───────────────────────────────────────────

/**
 * Parse a VM service method call into a human-readable action name,
 * selector string, and optional argument.
 */
function parseActionCall(
  method: string,
  params: Record<string, unknown>,
): { action: string; selector: string; argument?: string } {
  if (method === 'ext.fliwright.action') {
    const action = String(params.action ?? 'unknown');
    const selector = extractSelector(params);
    const argument = extractArgument(action, params);
    return { action, selector, argument };
  }

  if (method === 'ext.fliwright.navigate') {
    return { action: 'navigate', selector: String(params.path ?? '/'), argument: undefined };
  }

  if (method === 'ext.fliwright.goBack') {
    return { action: 'goBack', selector: '', argument: undefined };
  }

  if (method === 'ext.fliwright.click') {
    return { action: 'clickAt', selector: `${params.x},${params.y}`, argument: undefined };
  }

  if (method === 'ext.fliwright.dragFrom') {
    return { action: 'dragFrom', selector: `${params.x},${params.y}`, argument: `dx=${params.deltaX},dy=${params.deltaY}` };
  }

  // Generic fallback
  const shortMethod = method.replace('ext.fliwright.', '');
  return { action: shortMethod, selector: '', argument: undefined };
}

function extractSelector(params: Record<string, unknown>): string {
  // Common selector params from Locator.sendAction
  if (params.text) return `text=${params.text}`;
  if (params.textContains) return `textContains=${params.textContains}`;
  if (params.key) return `key=${params.key}`;
  if (params.type) return `byType=${params.type}`;
  if (params.id) return `id=${params.id}`;
  if (params.name) return `name=${params.name}`;
  if (params.ref) return `ref=${params.ref}`;
  if (params.semanticIdentifier) return `semantics=${params.semanticIdentifier}`;
  if (params.semanticsLabel) return `semanticsLabel=${params.semanticsLabel}`;
  if (params.role) return `role=${params.role}`;
  return '';
}

function extractArgument(action: string, params: Record<string, unknown>): string | undefined {
  if (action === 'type' || action === 'fill') {
    return typeof params.text === 'string' ? params.text : undefined;
  }
  if (action === 'pressKey') {
    return typeof params.key === 'string' ? params.key : undefined;
  }
  if (action === 'drag') {
    return params.deltaX != null || params.deltaY != null
      ? `dx=${params.deltaX ?? 0},dy=${params.deltaY ?? 0}`
      : undefined;
  }
  if (action === 'pinch') {
    return params.scale != null ? `scale=${params.scale}` : undefined;
  }
  if (action === 'selectOption') {
    return params.value != null ? String(params.value) : undefined;
  }
  if (action === 'setCheckbox') {
    return params.checked != null ? String(params.checked) : undefined;
  }
  return undefined;
}

// ── TraceStore (static helpers) ───────────────────────────────

/**
 * Static utilities for reading and managing trace data on disk.
 */
export namespace TraceStore {
  /**
   * Generate a runId from the current time.
   * Format: `2026-06-08T10-30-00`
   */
  export function generateRunId(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  /**
   * List all run IDs in the traces directory, sorted newest first.
   */
  export async function listRuns(traceRoot: string): Promise<string[]> {
    try {
      const entries = await readdir(traceRoot);
      const dirs: string[] = [];
      for (const entry of entries) {
        const p = join(traceRoot, entry);
        const s = await stat(p);
        if (s.isDirectory()) dirs.push(entry);
      }
      return dirs.sort().reverse();
    } catch {
      return [];
    }
  }

  /**
   * List test names within a specific run.
   */
  export async function listTests(traceRoot: string, runId: string): Promise<string[]> {
    try {
      const runDir = join(traceRoot, runId);
      const entries = await readdir(runDir);
      const dirs: string[] = [];
      for (const entry of entries) {
        const p = join(runDir, entry);
        const s = await stat(p);
        if (s.isDirectory()) dirs.push(entry);
      }
      return dirs;
    } catch {
      return [];
    }
  }

  /**
   * Load trace data for a specific test run.
   */
  export async function loadTrace(traceRoot: string, runId: string, testDir: string): Promise<TraceData | null> {
    try {
      const filePath = join(traceRoot, runId, testDir, TIMELINE_TRACE_FILE);
      const content = await readFile(filePath, 'utf8');
      return JSON.parse(content) as TraceData;
    } catch {
      return null;
    }
  }

  /**
   * Load all traces for a specific run.
   * Returns { testDirName: TraceData } pairs.
   */
  export async function loadAllTracesForRun(traceRoot: string, runId: string): Promise<Map<string, TraceData>> {
    const result = new Map<string, TraceData>();
    const tests = await listTests(traceRoot, runId);
    for (const testDir of tests) {
      const trace = await loadTrace(traceRoot, runId, testDir);
      if (trace) result.set(testDir, trace);
    }
    return result;
  }

  /**
   * Delete old runs, keeping only the N most recent.
   * Returns the number of deleted runs.
   */
  export async function cleanupOldRuns(traceRoot: string, keepCount: number): Promise<number> {
    const runs = await listRuns(traceRoot);
    if (runs.length <= keepCount) return 0;

    const toDelete = runs.slice(keepCount);
    for (const runId of toDelete) {
      await rm(join(traceRoot, runId), { recursive: true, force: true });
    }
    return toDelete.length;
  }
}

/**
 * Check if a VM service method is an action that should be traced.
 */
export function isActionMethod(method: string): boolean {
  return method === 'ext.fliwright.action'
    || method === 'ext.fliwright.navigate'
    || method === 'ext.fliwright.goBack'
    || method === 'ext.fliwright.click'
    || method === 'ext.fliwright.dragFrom';
}
