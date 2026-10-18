import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { ensureFliwrightRunsRoot, runManifestSchema, RunArtifactStore, recoverRunProgress } from '@fliwright/core';
import { loadConfig } from '../config.js';
import { artifactReferences, relativeArtifactPath } from '../ArtifactReferences.js';

export interface ArtifactOptions {
  cwd?: string;
  runsRoot?: string;
  runId?: string;
  allowPartial?: boolean;
}

export async function artifactsShowCommand(options: ArtifactOptions = {}) {
  const { runsRoot, runs } = await listRuns(options);
  const runId = options.runId ?? runs[0]?.runId;
  if (!runId) return { runsRoot, runs, report: null, reportIssue: undefined as string | undefined };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) throw new Error('Invalid runId.');
  const runDir = join(runsRoot, runId);
  const reportPath = join(runDir, 'report.json');
  let report: unknown;
  let reportIssue: string | undefined;
  try {
    report = await readJsonIfPresent(reportPath);
    if (report !== undefined && !isRecord(report)) throw new Error('Canonical report must be an object.');
  } catch (error) {
    report = undefined;
    reportIssue = 'report.json (unreadable)';
    if (!options.allowPartial) throw new Error(`Cannot read ${reportIssue}.`, { cause: error });
  }
  const manifest = await readJsonIfPresent(join(runDir, 'run.json'));
  if (report === undefined && manifest === undefined) {
    throw new Error(`Run '${runId}' has neither canonical report.json nor run.json manifest.`);
  }
  return { runsRoot, runId, reportPath, report: report ?? null, reportIssue, manifest: manifest ?? null, runs };
}

export async function artifactsExportCommand(options: ArtifactOptions & { output: string }) {
  const shown = await artifactsShowCommand(options);
  if (!shown.runId) throw new Error('No Fliwright run artifacts found to export.');
  const source = join(shown.runsRoot, shown.runId);
  const output = resolve(options.cwd ?? process.cwd(), options.output);
  try {
    await stat(output);
    throw new Error(`Artifact export destination already exists: ${output}`);
  } catch (error) {
    if (error instanceof Error && !('code' in error)) throw error;
    if (typeof error === 'object' && error && 'code' in error && error.code !== 'ENOENT') throw error;
  }
  const manifest = runManifestSchema.safeParse(shown.manifest);
  if (!manifest.success) throw new Error('Cannot export without a valid run.json manifest.');
  {
    const missing = await validateManifestFiles(source, manifest.data);
    if (shown.reportIssue) missing.push(shown.reportIssue);
    if (manifest.data.evidenceStatus === 'partial') missing.push('run.json (evidence is partial)');
    if (manifest.data.status === 'running' || manifest.data.status === 'interrupted') missing.push(`run.json (run is ${manifest.data.status})`);
    const documents = await readArtifactDocuments(source, manifest.data, shown.report);
    const rewrites = new Map<string, string>();
    const referencedFiles = new Set<string>();
    for (const document of documents) {
      if (document.data === undefined) {
        missing.push(`${document.path} (unreadable)`);
        continue;
      }
      const original = JSON.stringify(document.data);
      const base = document.kind === 'report' ? source : dirname(resolve(source, document.path));
      // Trace paths can use ../ to point back to the owning attempt.
      const boundary = document.kind === 'report' ? source : document.attemptDir!;
      for (const ref of artifactReferences(document.data, document.kind)) {
        const target = resolve(base, ref.path);
        const portable = relativeArtifactPath(boundary, target);
        const runRelative = relativeArtifactPath(source, target);
        const issue = await artifactPathIssue(boundary, target);
        if (portable === undefined || runRelative === undefined || issue === 'path escape') {
          missing.push(`${document.path}:${ref.path} (path escape)`);
          continue;
        }
        if (issue) missing.push(`${document.path}:${ref.path} (${issue})`);
        else referencedFiles.add(runRelative);
        ref.set(document.kind === 'report' ? runRelative || '.' : relative(base, target).split('\\').join('/'));
      }
      if (document.kind === 'report' && isRecord(document.data) && isRecord(document.data.artifacts)) {
        document.data.artifacts.outputDir = '.';
      }
      if (JSON.stringify(document.data) !== original) rewrites.set(document.path, `${JSON.stringify(document.data, null, 2)}\n`);
    }
    const canonicalReportExists = await exists(join(source, 'report.json'));
    if ((!canonicalReportExists || missing.length > 0) && !options.allowPartial) {
      throw new Error(`Run export is incomplete. Missing: ${[
        ...(!canonicalReportExists ? ['report.json'] : []),
        ...missing,
      ].join(', ')}`);
    }
    const partial = !canonicalReportExists || missing.length > 0;
    if (partial) {
      rewrites.set('run.json', `${JSON.stringify({ ...manifest.data, evidenceStatus: 'partial' }, null, 2)}\n`);
      rewrites.set('export.json', `${JSON.stringify({ schemaVersion: 1, runId: shown.runId, partial, missing }, null, 2)}\n`);
    }
    const files = new Set([
      'run.json',
      ...(partial ? ['export.json'] : []),
      ...(canonicalReportExists ? ['report.json'] : []),
      ...(await manifestAttemptFiles(source, manifest.data)),
      ...referencedFiles,
    ]);
    await publishFilesAtomically(source, output, files, rewrites);
    return { runId: shown.runId, source, output, partial, missing };
  }
}

interface ArtifactDocument {
  path: string;
  kind: Parameters<typeof artifactReferences>[1];
  data: unknown;
  attemptDir?: string;
}

async function readArtifactDocuments(source: string, manifest: ReturnType<typeof runManifestSchema.parse>, report: unknown): Promise<ArtifactDocument[]> {
  const documents: ArtifactDocument[] = report ? [{ path: 'report.json', kind: 'report', data: report }] : [];
  for (const attempt of manifest.tests.flatMap((test) => test.attempts.map((attempt) => ({ ...attempt, testId: test.testId })))) {
    const resultPath = resolve(source, attempt.resultPath);
    if (await artifactPathIssue(source, resultPath)) continue;
    const attemptDir = dirname(resultPath);
    let result: unknown;
    try { result = JSON.parse(await readFile(resultPath, 'utf8')); } catch { continue; }
    if (!isRecord(result)) continue;
    documents.push({ path: attempt.resultPath, kind: 'result', data: result, attemptDir });
    const context = isRecord(result) && typeof result.failureContextPath === 'string' ? result.failureContextPath : undefined;
    const children = [
      { name: 'timeline.json', kind: 'timeline' as const },
      { name: 'trace/trace.json', kind: 'trace' as const },
      ...(context ? [{ name: context, kind: 'failures' as const }] : []),
    ];
    for (const child of children) {
      const target = resolve(attemptDir, child.name);
      const issue = await artifactPathIssue(attemptDir, target);
      if (issue) continue;
      try {
        documents.push({ path: relative(source, target), kind: child.kind,
          data: JSON.parse(await readFile(target, 'utf8')), attemptDir });
      } catch { documents.push({ path: relative(source, target), kind: child.kind, data: undefined, attemptDir }); }
    }
  }
  return documents;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonIfPresent(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function validateManifestFiles(source: string, manifest: ReturnType<typeof runManifestSchema.parse>): Promise<string[]> {
  const missing: string[] = [];
  const store = new RunArtifactStore({ runsRoot: dirname(source), runId: manifest.runId });
  for (const attempt of manifest.tests.flatMap((test) => test.attempts.map((attempt) => ({ ...attempt, testId: test.testId })))) {
    const target = resolve(source, attempt.resultPath);
    const issue = await artifactPathIssue(source, target);
    if (issue) {
      missing.push(issue === 'path escape' ? `${attempt.resultPath} (path escape)` : attempt.resultPath);
      continue;
    }
    try {
      const result: unknown = JSON.parse(await readFile(target, 'utf8'));
      if (!isRecord(result)) throw new Error('Attempt result must be an object.');
      if (typeof result.eventsPath === 'string') {
        const eventsPath = resolve(dirname(target), result.eventsPath);
        const journalIssue = await artifactPathIssue(dirname(target), eventsPath);
        if (!journalIssue) {
          try {
            const recovered = recoverRunProgress(await store.readEvents(eventsPath), {
              runId: manifest.runId, testId: attempt.testId, attemptId: attempt.attemptId,
            });
            for (const issue of recovered.issues) missing.push(`${attempt.resultPath}:${result.eventsPath} (${issue})`);
            if (!recovered.finalized) missing.push(`${attempt.resultPath}:${result.eventsPath} (not finalized)`);
          } catch { missing.push(`${attempt.resultPath}:${result.eventsPath} (unreadable)`); }
        }
      }
      if (result.evidenceStatus === 'complete' || result.evidenceStatus === 'partial') {
        for (const file of ['timeline.json', 'trace/trace.json']) {
          const path = resolve(dirname(target), file);
          const issue = await artifactPathIssue(dirname(target), path);
          if (issue) missing.push(`${join(dirname(attempt.resultPath), file)}${issue === 'path escape' ? ' (path escape)' : ''}`);
        }
      }
      if (typeof result.failureContextPath === 'string') {
        const attemptDir = dirname(target);
        const contextPath = resolve(attemptDir, result.failureContextPath);
        const contextIssue = await artifactPathIssue(attemptDir, contextPath);
        if (contextIssue === 'path escape') {
          missing.push(`${attempt.resultPath}:${result.failureContextPath} (path escape)`);
        } else if (contextIssue) {
          missing.push(join(dirname(attempt.resultPath), result.failureContextPath));
        }
      }
    } catch {
      missing.push(`${attempt.resultPath} (unreadable)`);
    }
  }
  return missing;
}

async function manifestAttemptFiles(source: string, manifest: ReturnType<typeof runManifestSchema.parse>): Promise<string[]> {
  const files: string[] = [];
  for (const attempt of manifest.tests.flatMap((test) => test.attempts)) {
    const resultPath = resolve(source, attempt.resultPath);
    if (await artifactPathIssue(source, resultPath)) continue;
    if (!(await exists(resultPath))) continue;
    for (const file of await walkFiles(dirname(resultPath))) {
      const fileRelative = relative(source, file);
      if (fileRelative.startsWith('..') || isAbsolute(fileRelative)) continue;
      files.push(fileRelative.split('\\').join('/'));
    }
  }
  return files;
}

async function walkFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function publishFilesAtomically(source: string, output: string, files: Set<string>, rewrites = new Map<string, string>()): Promise<void> {
  const temporary = `${output}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(temporary, { recursive: true });
    for (const file of files) {
      const sourcePath = resolve(source, file);
      const destinationPath = join(temporary, file);
      await mkdir(dirname(destinationPath), { recursive: true });
      const rewritten = rewrites.get(file);
      if (rewritten !== undefined) await writeFile(destinationPath, rewritten, 'utf8');
      else if (await exists(sourcePath)) await cp(sourcePath, destinationPath, { dereference: true });
    }
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolve symlinks as well as lexical paths before reading or copying evidence. */
export async function artifactPathIssue(boundary: string, target: string): Promise<'path escape' | 'missing' | 'not a file' | undefined> {
  if (relativeArtifactPath(boundary, target) === undefined) return 'path escape';
  try {
    const [actualBoundary, actualTarget] = await Promise.all([realpath(boundary), realpath(target)]);
    if (relativeArtifactPath(actualBoundary, actualTarget) === undefined) return 'path escape';
    return (await stat(actualTarget)).isFile() ? undefined : 'not a file';
  } catch { return 'missing'; }
}

async function listRuns(options: ArtifactOptions) {
  const cwd = options.cwd ?? process.cwd();
  const config = await loadConfig(cwd);
  const runsRoot = await ensureFliwrightRunsRoot({ projectRoot: cwd, runsRoot: options.runsRoot ?? config.runsRoot });
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const runs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => ({
    runId: basename(entry.name),
    modifiedAt: (await stat(join(runsRoot, entry.name))).mtime.toISOString(),
  })));
  runs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  return { runsRoot, runs };
}
