import {
  ensureFliwrightRunsRoot,
  FLIWRIGHT_RUNS_ROOT_ENV,
  TIMELINE_ARTIFACT_KIND_SCREENSHOT,
  TIMELINE_FILE_NAME,
} from '@fliwright/core';
import { resolveVmUrl } from '../vm-discovery.js';
import { loadConfig } from '../config.js';
import { formatPretty, formatJson, formatJunit, type CliFailureEntry, type CliRunResult } from '../reporter.js';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);

export interface RunOptions {
  testPattern?: string;
  testName?: string;
  vmUrl?: string;
  reporter?: 'pretty' | 'json' | 'junit' | 'ai-json';
  timeout?: number;
  screenshot?: 'file' | 'base64' | 'off';
  output?: string;
  cwd?: string;
  print?: boolean;
  runsRoot?: string;
}

export interface RunDeps {
  resolveVmUrl?: (options: { cliFlag?: string; configUrl?: string; cwd?: string }) => Promise<string | null>;
  onVmResolved?: (url: string) => void;
}

export async function runCommand(options: RunOptions, deps: RunDeps = {}): Promise<CliRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(cwd);

  const reporter = options.reporter ?? config.reporter;
  const testPattern = options.testPattern ?? `${config.testDir}/**/*.test.ts`;
  const timeout = options.timeout ?? config.timeout ?? 30000;
  const screenshot = options.screenshot ?? 'file';
  const runId = createRunId();

  const resolver = deps.resolveVmUrl ?? resolveVmUrl;
  const vmUrl = await resolver({
    cliFlag: options.vmUrl,
    configUrl: config.vmServiceUrl,
    cwd,
  });

  if (!vmUrl) {
    throw new Error(
      'Could not find a running Flutter VM Service.\n\n' +
      '   Start your Flutter app first: flutter run\n' +
      '   Then re-run: fliwright run\n' +
      '   Or specify: fliwright run --vm-url ws://127.0.0.1:8181/ws',
    );
  }

  deps.onVmResolved?.(vmUrl);

  const runsRoot = await ensureFliwrightRunsRoot({
    projectRoot: cwd,
    runsRoot: options.runsRoot ?? config.runsRoot,
  });
  const outputDir = join(runsRoot, runId);
  const reportPath = options.output ? resolve(cwd, options.output) : join(outputDir, 'report.json');

  const vitestResult = await runVitest({
    testPattern,
    testName: options.testName,
    vmUrl,
    cwd,
    failureContextPath: join(outputDir, 'failures.json'),
    timeout,
    screenshot,
    runId,
    runsRoot,
  });
  const withArtifacts = await attachArtifacts(vitestResult, {
    cwd,
    outputDir,
    reportPath,
    runId,
    runsRoot,
    screenshot,
    testPattern,
    testName: options.testName,
  });
  const formatted = formatOutput(withArtifacts, reporter);

  if (options.print !== false) {
    console.log(formatted);
  }
  return withArtifacts;
}

interface RunVitestOptions {
  testPattern: string,
  testName?: string;
  vmUrl: string;
  cwd: string;
  failureContextPath: string;
  timeout: number;
  screenshot: 'file' | 'base64' | 'off';
  runId?: string;
  runsRoot?: string;
}

export async function runVitest(options: RunVitestOptions): Promise<CliRunResult> {
  const packageJson = require.resolve('vitest/package.json');
  const vitestCli = join(dirname(packageJson), 'vitest.mjs');
  const args = [vitestCli, 'run', options.testPattern, '--reporter=json', '--testTimeout', String(options.timeout)];
  if (options.testName) {
    args.push('--testNamePattern', options.testName);
  }

  await mkdir(dirname(options.failureContextPath), { recursive: true });
  const { stdout } = await execNode(
    args,
    {
      ...process.env,
      FLIWRIGHT_VM_URL: options.vmUrl,
      FLIWRIGHT_MCP_FAILURE_CONTEXT_PATH: options.failureContextPath,
      FLIWRIGHT_SCREENSHOT_MODE: options.screenshot,
      FLIWRIGHT_FAILURE_TIMEOUT_MS: String(options.timeout),
      ...(options.runId ? { FLIWRIGHT_RUN_ID: options.runId } : {}),
      ...(options.runsRoot ? { [FLIWRIGHT_RUNS_ROOT_ENV]: options.runsRoot } : {}),
    },
    options.cwd,
  );

  const result = parseVitestOutput(stdout);
  const failures = await readFailureContext(options.failureContextPath);
  return failures.length > 0 ? { ...result, failures } : result;
}

function execNode(
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout, stderr }));
  });
}

interface VitestJsonReport {
  success?: boolean;
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  startTime?: number;
  testResults?: Array<{
    assertionResults?: Array<{
      fullName?: string;
      title?: string;
      status?: string;
      duration?: number | null;
      failureMessages?: string[];
    }>;
  }>;
}

export function parseVitestOutput(raw: string): CliRunResult {
  const trimmed = raw.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return { passed: false, totalTests: 0, passedTests: 0, failedTests: 0, duration: 0, results: [] };
  }

  let report: VitestJsonReport;
  try {
    report = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return { passed: false, totalTests: 0, passedTests: 0, failedTests: 0, duration: 0, results: [] };
  }

  const results = (report.testResults ?? []).flatMap((fileResult) =>
    (fileResult.assertionResults ?? []).map((assertion) => {
      const passed = assertion.status === 'passed';
      return {
        name: assertion.fullName ?? assertion.title ?? '<unknown>',
        passed,
        duration: assertion.duration ?? 0,
        ...(passed ? {} : { error: (assertion.failureMessages ?? []).join('\n') }),
      };
    }),
  );

  const duration = report.startTime ? Math.max(0, Date.now() - report.startTime) : 0;

  return {
    passed: report.success === true,
    totalTests: report.numTotalTests ?? results.length,
    passedTests: report.numPassedTests ?? results.filter((r) => r.passed).length,
    failedTests: report.numFailedTests ?? results.filter((r) => !r.passed).length,
    duration,
    results,
  };
}

async function readFailureContext(path: string): Promise<CliFailureEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CliFailureEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function attachArtifacts(
  result: CliRunResult,
  options: {
    cwd: string;
    outputDir: string;
    reportPath: string;
    runId: string;
    runsRoot: string;
    screenshot: 'file' | 'base64' | 'off';
    testPattern: string;
    testName?: string;
  },
): Promise<CliRunResult> {
  await mkdir(options.outputDir, { recursive: true });
  const screenshots: string[] = [];
  const failures = await persistScreenshots(result.failures ?? [], options.outputDir, options.screenshot, screenshots);
  const { timelines, agentVisibleFailures } = await readTimelineSummaries(options.runsRoot, options.runId);
  const report: CliRunResult = {
    ...result,
    ...(failures.length > 0 ? { failures } : {}),
    artifacts: {
      runId: options.runId,
      outputDir: options.outputDir,
      reportPath: options.reportPath,
      screenshots,
      timelines: timelines.map((timeline) => timeline.path),
    },
    ...(timelines.length ? { timelines, agentVisibleFailures } : {}),
    reproduceCommand: buildReproduceCommand(options.testPattern, options.testName),
  };
  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

async function readTimelineSummaries(
  runsRoot: string,
  runId: string,
): Promise<{
  timelines: NonNullable<CliRunResult['timelines']>;
  agentVisibleFailures: NonNullable<CliRunResult['agentVisibleFailures']>;
}> {
  const entries = await findTimelineFiles(runsRoot, runId);
  const summaries: NonNullable<CliRunResult['timelines']> = [];
  const agentVisibleFailures: NonNullable<CliRunResult['agentVisibleFailures']> = [];
  for (const path of entries) {
    try {
      const data = JSON.parse(await readFile(path, 'utf8')) as {
        mode?: 'script' | 'test';
        nodes?: Array<{
          kind?: string;
          status?: string;
          artifacts?: Array<{ kind?: string }>;
        }>;
        agentVisibleFailures?: Array<{ code: string; title: string; message: string; timelineNodeId?: string }>;
      };
      const nodes = data.nodes ?? [];
      const failures = data.agentVisibleFailures ?? [];
      summaries.push({
        path,
        mode: data.mode,
        pages: nodes.filter((node) => node.kind === 'page').length,
        stepsPassed: nodes.filter((node) => node.kind === 'step' && node.status === 'passed').length,
        stepsFailed: nodes.filter((node) => node.kind === 'step' && node.status === 'failed').length,
        screenshots: nodes.reduce((count, node) => count + (node.artifacts?.filter((artifact) => artifact.kind === TIMELINE_ARTIFACT_KIND_SCREENSHOT).length ?? 0), 0),
        firstFailure: failures[0],
      });
      agentVisibleFailures.push(...failures);
    } catch {
      // Ignore malformed sidecar timelines.
    }
  }
  return { timelines: summaries, agentVisibleFailures };
}

async function findTimelineFiles(runsRoot: string, runId: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name !== runId && !entry.name.startsWith(`${runId}-`)) continue;
      const path = join(runsRoot, entry.name);
      found.push(...await findTimelineFilesInRunDir(path));
    }
  } catch {
    return [];
  }
  return found;
}

async function findTimelineFilesInRunDir(runDir: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const entries = await readdir(runDir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(runDir, entry.name);
      if (entry.isDirectory()) {
        const candidate = join(path, TIMELINE_FILE_NAME);
        try {
          await readFile(candidate, 'utf8');
          found.push(candidate);
        } catch {
          found.push(...await findTimelineFilesInRunDir(path));
        }
      } else if (entry.isFile() && entry.name === TIMELINE_FILE_NAME) {
        found.push(path);
      }
    }
  } catch {
    return [];
  }
  return found;
}

async function persistScreenshots(
  failures: CliFailureEntry[],
  outputDir: string,
  screenshotMode: 'file' | 'base64' | 'off',
  screenshots: string[],
): Promise<CliFailureEntry[]> {
  if (screenshotMode !== 'file') return failures;

  const screenshotDir = join(outputDir, 'screenshots');
  await mkdir(screenshotDir, { recursive: true });
  const persisted: CliFailureEntry[] = [];
  for (let index = 0; index < failures.length; index++) {
    const failure = failures[index];
    const base64 = failure.screenshot?.base64;
    if (!base64) {
      persisted.push(failure);
      continue;
    }
    const filename = `${index + 1}-${safeFilename(failure.testName)}.png`;
    const path = join(screenshotDir, filename);
    await writeFile(path, Buffer.from(base64, 'base64'));
    screenshots.push(path);
    persisted.push({
      ...failure,
      screenshot: {
        mimeType: 'image/png',
        path,
      },
    });
  }
  return persisted;
}

function createRunId(): string {
  return `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'failure';
}

function buildReproduceCommand(testPattern: string, testName?: string): string {
  const parts = ['fliwright run', '--test', shellQuote(testPattern)];
  if (testName) parts.push('--test-name', shellQuote(testName));
  return parts.join(' ');
}

function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatOutput(result: CliRunResult, reporter: string): string {
  switch (reporter) {
    case 'ai-json':
    case 'json':
      return formatJson(result);
    case 'junit':
      return formatJunit(result);
    case 'pretty':
    default:
      return formatPretty(result);
  }
}
