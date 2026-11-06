import { lstat, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { evidenceStatusSchema, runManifestSchema, runStatusSchema } from '@fliwright/core';
import { z } from 'zod';
import { artifactPathIssue, artifactsShowCommand, type ArtifactOptions } from './artifacts.js';
import { renderHtmlReport, type HtmlReportAttempt, type HtmlReportStep, type HtmlReportTest } from '../HtmlReport.js';
import { assessRelease, loadReleasePlan, loadReleaseReview, releaseMetadataSchema, type ReleaseMetadata } from '../ReleaseReview.js';
import { CliError } from '../CommandRegistry.js';
import { deviceMetadataSchema } from '../DeviceMetadata.js';
import { loadReportProjectIcon } from '../ReportProjectIcon.js';

const operationSchema = z.object({ title: z.string(), outcome: runStatusSchema, startedAt: z.string(), endedAt: z.string().optional(),
  error: z.unknown().optional() }).passthrough();
const attemptSchema = z.object({ testName: z.string(), testFile: z.string().optional(), status: runStatusSchema,
  testPath: z.array(z.string()).optional(),
  testOutcome: runStatusSchema.optional(), attemptOutcome: runStatusSchema.optional(), attemptIndex: z.number().optional(),
  flaky: z.boolean().optional(), expectedFailure: z.boolean().optional(), evidenceStatus: evidenceStatusSchema,
  evidenceIssues: z.array(z.string()).optional(), failureContextPath: z.string().optional(),
  operations: z.array(operationSchema).default([]),
  evidence: z.array(z.object({ result: z.object({ artifactPaths: z.array(z.string()).optional() }).passthrough() }).passthrough()).default([]),
}).passthrough();
const timelineSchema = z.object({ startedAt: z.string().optional(), endedAt: z.string().optional(), nodes: z.array(z.object({
  id: z.string(), parentId: z.string().optional(), title: z.string(), kind: z.string(), status: runStatusSchema,
  startedAt: z.string(), endedAt: z.string().optional(), route: z.string().optional(),
  codeRef: z.object({ file: z.string(), line: z.number() }).optional(), error: z.unknown().optional(),
  artifacts: z.array(z.object({ kind: z.string(), path: z.string() }).passthrough()).optional(),
}).passthrough()) }).passthrough();
const reportSchema = z.object({ duration: z.number().nonnegative().optional(),
  release: releaseMetadataSchema.optional(),
  device: deviceMetadataSchema.optional(),
  passed: z.boolean().optional(), status: runStatusSchema.optional(), totalTests: z.number().int().nonnegative().optional(),
  results: z.array(z.object({ name: z.string(), passed: z.boolean(), duration: z.number(), error: z.string().optional(),
    status: runStatusSchema.optional(), file: z.string().optional() })).default([]),
  runnerErrors: z.array(z.object({ phase: z.string(), message: z.string(), stack: z.string().optional() })).default([]),
}).passthrough();

/** Render saved run evidence to one offline HTML file, including screenshots from successful attempts. */
export async function artifactsReportCommand(options: ArtifactOptions & { output?: string; review?: string; plan?: string; release?: ReleaseMetadata; signal?: AbortSignal } = {}) {
  if (options.review && options.plan) throw new CliError('INVALID_INPUT', 'Choose review or plan, not both.', 2);
  if (options.release && !options.plan) throw new CliError('INVALID_INPUT', 'Report release metadata requires plan; otherwise provide it in review.', 2);
  const release = options.release ? releaseMetadataSchema.parse(options.release) : undefined;
  const shown = await artifactsShowCommand(options);
  if (!shown.runId) throw new Error('No Fliwright run artifacts found to render.');
  const manifest = runManifestSchema.parse(shown.manifest);
  const root = join(shown.runsRoot, shown.runId);
  const output = options.output ? resolve(options.cwd ?? process.cwd(), options.output) : join(root, 'report.html');
  if (!output.toLowerCase().endsWith('.html')) throw new Error('Report output must end in .html.');
  const reviewPath = options.plan ? join(dirname(output), `${basename(output).slice(0, -5)}.review.json`) : undefined;
  const missing = new Set<string>();
  if (shown.reportIssue) missing.add(shown.reportIssue);
  if (!shown.report) missing.add('report.json (missing)');
  const report = shown.report ? reportSchema.parse(shown.report) : reportSchema.parse({});
  const review = options.review ? await loadReleaseReview(resolve(options.cwd ?? process.cwd(), options.review), options.signal)
    : options.plan ? await loadReleasePlan(resolve(options.cwd ?? process.cwd(), options.plan), shown.runId, options.signal) : undefined;
  if (review && release) review.release = release;
  for (const path of [output, ...(reviewPath ? [reviewPath] : [])]) {
    try { await lstat(path); throw new Error(`Report destination already exists: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (manifest.evidenceStatus === 'partial') missing.add('run.json (evidence is partial)');
  if (manifest.status === 'running' || manifest.status === 'interrupted') missing.add(`run.json (run is ${manifest.status})`);
  const check = () => options.signal?.throwIfAborted();
  async function readJson(boundary: string, path: string): Promise<unknown> {
    check();
    const issue = await artifactPathIssue(boundary, path);
    if (issue) throw new Error(issue);
    return JSON.parse(await readFile(path, { encoding: 'utf8', signal: options.signal }));
  }
  const images = new Map<string, string | undefined>();
  let imageBytes = 0;
  async function image(boundary: string, reference: string): Promise<string | undefined> {
    check();
    const path = resolve(boundary, reference);
    try {
      if (/^[a-z][a-z\d+.-]*:/i.test(reference)) throw new Error('external image reference');
      const issue = await artifactPathIssue(boundary, path);
      if (issue) throw new Error(issue);
      if (images.has(path)) return images.get(path);
      const size = (await stat(path)).size;
      if (size > 10 * 1024 * 1024 || imageBytes + size > 64 * 1024 * 1024) throw new Error('image exceeds embedding limit');
      const bytes = await readFile(path, { signal: options.signal });
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
        : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) ? 'image/gif'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : undefined;
      if (!mime) throw new Error('unsupported image format');
      imageBytes += bytes.length;
      const data = `data:${mime};base64,${bytes.toString('base64')}`;
      images.set(path, data);
      return data;
    } catch (error) {
      check();
      missing.add(`${reference} (${error instanceof Error ? error.message : 'unreadable'})`);
      images.set(path, undefined);
      return undefined;
    }
  }
  const tests: HtmlReportTest[] = [];
  const unmatched = [...report.results];
  for (const test of manifest.tests) {
    const attempts: HtmlReportAttempt[] = [];
    for (const ref of [...test.attempts].sort((a, b) => a.attemptId.localeCompare(b.attemptId, undefined, { numeric: true }))) {
      const path = resolve(root, ref.resultPath);
      const attempt: HtmlReportAttempt = { id: ref.attemptId, status: 'interrupted', outcome: 'interrupted', evidenceStatus: 'partial', steps: [], failures: [], images: [] };
      attempts.push(attempt);
      try {
        const result = attemptSchema.parse(await readJson(root, path));
        const boundary = dirname(path);
        attempt.name = result.testPath?.join(' ') || result.testName;
        attempt.file = result.testFile;
        attempt.status = result.attemptOutcome ?? result.status;
        attempt.outcome = result.testOutcome ?? result.status;
        attempt.evidenceStatus = result.evidenceStatus;
        attempt.flaky = result.flaky;
        attempt.expectedFailure = result.expectedFailure;
        if (result.evidenceStatus === 'partial') missing.add(`${ref.resultPath} (evidence is partial)`);
        for (const issue of result.evidenceIssues ?? []) missing.add(`${ref.resultPath}: ${issue}`);
        // Optional timelines are absent when automatic recording is disabled.
        try {
          const timeline = timelineSchema.parse(await readJson(boundary, join(boundary, 'timeline.json')));
          attempt.startedAt = timeline.startedAt;
          attempt.endedAt = timeline.endedAt;
          for (const node of timeline.nodes) {
            const step: HtmlReportStep = { title: node.title, kind: node.kind, status: node.status,
              startedAt: node.startedAt, endedAt: node.endedAt, route: node.route, source: node.codeRef, error: node.error,
              nested: Boolean(node.parentId), images: [] };
            for (const artifact of node.artifacts ?? []) {
              if (artifact.kind !== 'screenshot') continue;
              const data = await image(boundary, artifact.path);
              if (data) step.images.push({ data, title: node.title });
            }
            attempt.steps.push(step);
          }
        } catch (error) {
          check();
          if (result.evidenceStatus !== 'disabled') missing.add(`${ref.resultPath}: timeline.json (${error instanceof Error ? error.message : 'unreadable'})`);
        }
        if (!attempt.steps.length) attempt.steps = result.operations.map(operation => ({ title: operation.title, kind: 'step', status: operation.outcome,
          startedAt: operation.startedAt, endedAt: operation.endedAt, error: operation.error, images: [] }));
        const seen = new Set(attempt.steps.flatMap(step => step.images.map(entry => entry.data)));
        for (const evidence of result.evidence) for (const reference of evidence.result.artifactPaths ?? []) {
          // Evidence records also include snapshots/diagnostics; only images belong in the gallery.
          if (!/\.(png|jpe?g|gif|webp)$/i.test(reference)) continue;
          const data = await image(boundary, reference);
          if (data && !seen.has(data)) { seen.add(data); attempt.images.push({ data, title: '测试截图' }); }
        }
        if (result.failureContextPath) {
          const failures = z.array(z.unknown()).parse(await readJson(boundary, resolve(boundary, result.failureContextPath)));
          attempt.failures = failures;
        }
      } catch (error) {
        check();
        missing.add(`${ref.resultPath} (${error instanceof Error ? error.message : 'unreadable'})`);
      }
    }
    const last = attempts.at(-1);
    const name = last?.name ?? test.testId;
    const match = unmatched.findIndex(entry => {
      if (entry.name !== name) return false;
      if (!entry.file || !last?.file) return true;
      const file = entry.file.replaceAll('\\', '/');
      const relativeFile = last.file.replaceAll('\\', '/');
      return file === relativeFile || file.endsWith(`/${relativeFile}`);
    });
    const raw = match >= 0 ? unmatched.splice(match, 1)[0] : undefined;
    tests.push({ id: test.testId, name, file: last?.file, status: last?.outcome ?? 'interrupted', attempts, duration: raw?.duration,
      error: raw?.error, flaky: last?.outcome === 'passed' && (attempts.some(attempt => attempt.flaky)
        || (attempts.length > 1 && attempts.some(attempt => attempt.status === 'failed' && !attempt.expectedFailure))) });
  }
  // Plain Vitest tests (and tests skipped before fixtures run) have no attempt directory.
  for (const [index, result] of unmatched.entries()) tests.push({ id: `runner-${index}`, name: result.name,
    status: result.status ?? (result.passed ? 'passed' : 'failed'), file: result.file, duration: result.duration, error: result.error, attempts: [] });
  check();
  if (missing.size && !options.allowPartial) throw new Error(`Report evidence is incomplete. Use --allow-partial to include available evidence. Missing: ${[...missing].join(', ')}`);
  const runnerErrors = [...new Map([...(manifest.runnerErrors ?? []), ...report.runnerErrors].map(error => [JSON.stringify(error), error])).values()];
  const summaryConfirmed = report.passed === true && (report.status === undefined || report.status === 'passed')
    && report.totalTests === tests.length && report.results.length === tests.length
    && report.results.every(test => test.passed && (test.status === undefined || test.status === 'passed'));
  const assessment = assessRelease({ runId: manifest.runId, status: manifest.status, evidenceStatus: manifest.evidenceStatus,
    tests, missing: [...missing], runnerErrors, review, recordedRelease: report.release, summaryConfirmed });
  const html = renderHtmlReport({ runId: shown.runId, status: manifest.status, evidenceStatus: manifest.evidenceStatus,
    tests, duration: report.duration, device: report.device ?? review?.device, runnerErrors, missing: [...missing], assessment,
    projectIcon: await loadReportProjectIcon(options.cwd ?? process.cwd(), assessment.release.app, options.signal) });
  await mkdir(dirname(output), { recursive: true });
  if (reviewPath) {
    await writeFile(reviewPath, `${JSON.stringify({ runId: shown.runId, release: { ...report.release, ...review?.release },
      device: report.device,
      plan: relative(dirname(reviewPath), resolve(options.cwd ?? process.cwd(), options.plan!)).replaceAll('\\', '/') }, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx', signal: options.signal });
  }
  try { await writeFile(output, html, { encoding: 'utf8', flag: 'wx', signal: options.signal }); }
  catch (error) { if (reviewPath) await rm(reviewPath, { force: true }); throw error; }
  return { runId: shown.runId, output, partial: missing.size > 0, missing: [...missing], tests: tests.length,
    reviewPath: reviewPath ?? (options.review ? resolve(options.cwd ?? process.cwd(), options.review) : undefined),
    plannedCases: assessment.issues.reduce((count, issue) => count + issue.cases.length, 0),
    automatedCases: assessment.issues.reduce((count, issue) => count + issue.cases.filter(entry => entry.definition.binding).length, 0),
    missingReleaseFields: assessment.missingReleaseFields, releaseReady: assessment.releaseReady, blockers: assessment.blockers };
}
