import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactsExportCommand, artifactsShowCommand } from '../src/commands/artifacts.js';
import { RunArtifactStore, RunProgressJournal, RunSession } from '@fliwright/core';

describe('manifest-backed artifact commands', () => {
  it('resolves an explicit relative runs root from the project when queried in a child directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-query-project-'));
    try {
      await mkdir(join(root, 'child'));
      await mkdir(join(root, 'custom-runs', 'run-one'), { recursive: true });
      await writeFile(join(root, 'fliwright.config.ts'), 'export default {};');
      await writeFile(join(root, 'custom-runs/run-one/run.json'), JSON.stringify({ runId: 'run-one' }));
      const shown = await artifactsShowCommand({ cwd: join(root, 'child'), runsRoot: 'custom-runs', runId: 'run-one' });
      expect(shown.runsRoot).toBe(join(root, 'custom-runs'));
      expect(shown.manifest).toEqual({ runId: 'run-one' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('requires a canonical manifest instead of copying a legacy directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-export-no-manifest-'));
    try {
      await mkdir(join(root, 'old-run'));
      await writeFile(join(root, 'old-run/report.json'), '{}');
      await expect(artifactsExportCommand({ runsRoot: root, runId: 'old-run', output: join(root, 'export'), allowPartial: true }))
        .rejects.toThrow('run.json');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  async function referencedRun() {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-export-evidence-'));
    const runDir = join(root, 'run-evidence');
    const prefix = 'tests/test-1/attempts/attempt-0';
    const attempt = join(runDir, prefix);
    await mkdir(join(attempt, 'trace'), { recursive: true });
    await writeFile(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 1, runId: 'run-evidence',
      status: 'passed', evidenceStatus: 'complete',
      tests: [{ testId: 'test-1', attempts: [{ attemptId: 'attempt-0', resultPath: prefix + '/result.json' }] }],
    }));
    await writeFile(join(runDir, 'report.json'), JSON.stringify({ artifacts: { runId: 'run-evidence',
      outputDir: runDir, manifestPath: join(runDir, 'run.json'), reportPath: join(runDir, 'report.json'),
      screenshots: [join(attempt, 'frame.png')], timelines: [join(attempt, 'timeline.json')],
    }, timelines: [{ path: join(attempt, 'timeline.json') }],
      failures: [{ screenshot: { path: join(attempt, 'frame.png') } }],
    }));
    await writeFile(join(attempt, 'result.json'), JSON.stringify({ evidenceStatus: 'complete',
      evidence: [{ result: { status: 'captured', artifactPaths: ['frame.png'] } }],
      failureContextPath: 'failures.json',
    }));
    await writeFile(join(attempt, 'timeline.json'), JSON.stringify({ version: 2,
      nodes: [{ artifacts: [{ kind: 'screenshot', path: 'frame.png' }] }],
      agentVisibleFailures: [{ appState: { screenshotPath: 'frame.png' } }],
    }));
    await writeFile(join(attempt, 'trace/trace.json'), JSON.stringify({ steps: [{ screenshotFile: '../frame.png' }] }));
    await writeFile(join(attempt, 'failures.json'), JSON.stringify([{ screenshot: { path: 'frame.png' } }]));
    await writeFile(join(attempt, 'frame.png'), 'frame');
    return { root, runDir, attempt, prefix };
  }

  it('exports attempt-owned AI records with portable references', async () => {
    const { root, runDir, attempt, prefix } = await referencedRun();
    try {
      const directory = 'artifacts/ai/invocation-one';
      await mkdir(join(attempt, directory), { recursive: true });
      await writeFile(join(attempt, directory, 'response.txt'), 'saved AI response');
      await writeFile(join(attempt, 'timeline.json'), JSON.stringify({ version: 2,
        nodes: [{ kind: 'ai-call', metadata: { artifactsDir: directory }, artifacts: [] }],
      }));
      const output = join(root, 'portable');
      await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output });
      await rm(runDir, { recursive: true, force: true });
      const timeline = JSON.parse(await readFile(join(output, prefix, 'timeline.json'), 'utf8'));
      expect(timeline.nodes[0].metadata.artifactsDir).toBe(directory);
      expect(await readFile(join(output, prefix, directory, 'response.txt'), 'utf8')).toBe('saved AI response');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['tail', 'gap', 'corrupt', 'missing'] as const)('validates a referenced progress journal (%s) before export', async (damage) => {
    const { root, runDir, attempt } = await referencedRun();
    try {
      const store = new RunArtifactStore({ runsRoot: root, runId: 'run-evidence' });
      const session = new RunSession({ runId: 'run-evidence', testId: 'test-1', testName: 'journal', attemptId: 'attempt-0' });
      const result = await session.finish({ status: 'passed', evidenceStatus: 'complete' });
      result.eventsPath = 'events.jsonl';
      const journal = new RunProgressJournal(store, 'test-1', 'attempt-0');
      await journal.append(result, undefined, true);
      await writeFile(join(attempt, 'result.json'), JSON.stringify(result));
      const log = join(attempt, 'events.jsonl');
      if (damage === 'tail') await import('node:fs/promises').then(({ appendFile }) => appendFile(log, '{unfinished'));
      if (damage === 'gap') {
        const event = JSON.parse(await readFile(log, 'utf8'));
        event.sequence = 2;
        await writeFile(log, JSON.stringify(event) + '\n');
      }
      if (damage === 'corrupt') await writeFile(log, '{bad complete line}\n');
      if (damage === 'missing') await rm(log);
      await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
        .rejects.toThrow('events.jsonl');
      const output = join(root, 'partial');
      const partial = await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output, allowPartial: true });
      expect(partial.partial).toBe(true);
      expect(partial.missing.join(' ')).toContain('events.jsonl');
      expect(JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')).evidenceStatus).toBe('complete');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('preserves an unreadable canonical report only in an explicitly partial export', async () => {
    const { root, runDir } = await referencedRun();
    try {
      await writeFile(join(runDir, 'report.json'), '{unfinished report');
      await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
        .rejects.toThrow('unreadable');
      const output = join(root, 'partial');
      const exported = await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output, allowPartial: true });
      expect(exported.partial).toBe(true);
      expect(exported.missing.join(' ')).toContain('report.json (unreadable)');
      expect(await readFile(join(output, 'report.json'), 'utf8')).toBe('{unfinished report');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['null', '42', '[]'])('rejects a non-object canonical report (%s)', async (content) => {
    const { root, runDir } = await referencedRun();
    try {
      await writeFile(join(runDir, 'report.json'), content);
      await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
        .rejects.toThrow('unreadable');
      const output = join(root, 'partial');
      const exported = await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output, allowPartial: true });
      expect(exported.partial).toBe(true);
      expect(await readFile(join(output, 'report.json'), 'utf8')).toBe(content);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['timeline.json', 'trace/trace.json'])('rejects missing %s for an attempt claiming complete evidence', async (file) => {
    const { root, attempt, runDir } = await referencedRun();
    try {
      // Remove report references too: required projections must not depend on
      // whether the report happens to enumerate them.
      await writeFile(join(runDir, 'report.json'), '{}');
      await rm(join(attempt, file));
      await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
        .rejects.toThrow(file);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('rejects a screenshot symlink escaping the attempt and materializes internal symlinks', async () => {
    const { root, attempt } = await referencedRun();
    try {
      await writeFile(join(root, 'outside.png'), 'external bytes');
      await rm(join(attempt, 'frame.png'));
      await symlink(join(root, 'outside.png'), join(attempt, 'frame.png'));
      await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
        .rejects.toThrow('path escape');
      const partial = await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'partial'), allowPartial: true });
      expect(partial.partial).toBe(true);
      await expect(readFile(join(root, 'partial/tests/test-1/attempts/attempt-0/frame.png'))).rejects.toThrow();
      await rm(join(attempt, 'frame.png'));
      await writeFile(join(attempt, 'internal.png'), 'internal bytes');
      await symlink(join(attempt, 'internal.png'), join(attempt, 'frame.png'));
      const output = join(root, 'complete');
      await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output });
      await rm(attempt, { recursive: true });
      expect(await readFile(join(output, 'tests/test-1/attempts/attempt-0/frame.png'), 'utf8')).toBe('internal bytes');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(['result', 'timeline', 'trace', 'failure', 'report'] as const)('rejects missing %s evidence references and identifies partial exports', async (location) => {
    const { root, runDir, attempt } = await referencedRun();
    const missing = 'missing-' + location + '.png';
    if (location === 'result') await writeFile(join(attempt, 'result.json'), JSON.stringify({ evidence: [{ result: { artifactPaths: [missing] } }] }));
    if (location === 'timeline') await writeFile(join(attempt, 'timeline.json'), JSON.stringify({ nodes: [{ artifacts: [{ path: missing }] }] }));
    if (location === 'trace') await writeFile(join(attempt, 'trace/trace.json'), JSON.stringify({ steps: [{ screenshotFile: '../' + missing }] }));
    if (location === 'failure') await writeFile(join(attempt, 'failures.json'), JSON.stringify([{ screenshot: { path: missing } }]));
    if (location === 'report') await writeFile(join(runDir, 'report.json'), JSON.stringify({ artifacts: { screenshots: [missing] } }));
    await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
      .rejects.toThrow(missing);
    const partial = await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'partial'), allowPartial: true });
    expect(partial.partial).toBe(true);
    expect(partial.missing.join(' ')).toContain(missing);
    const manifest = JSON.parse(await readFile(join(root, 'partial/run.json'), 'utf8'));
    expect(manifest.evidenceStatus).toBe('partial');
    const exportInfo = JSON.parse(await readFile(join(root, 'partial/export.json'), 'utf8'));
    expect(exportInfo).toMatchObject({ runId: 'run-evidence', partial: true, missing: partial.missing });
    await rm(root, { recursive: true, force: true });
  });

  it('relocates canonical report references so an export opens after its source is removed', async () => {
    const { root, runDir, prefix } = await referencedRun();
    const output = join(root, 'moved-run');
    await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output });
    await rm(runDir, { recursive: true });
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    expect(report.artifacts.outputDir).toBe('.');
    expect(report.artifacts.manifestPath).toBe('run.json');
    expect(report.artifacts.timelines).toEqual([prefix + '/timeline.json']);
    expect(report.timelines[0].path).toBe(prefix + '/timeline.json');
    expect(report.failures[0].screenshot.path).toBe(prefix + '/frame.png');
    expect(await readFile(join(output, report.artifacts.screenshots[0]), 'utf8')).toBe('frame');
    await rm(root, { recursive: true, force: true });
  });

  it.each(['timeline.json', 'trace/trace.json', 'failures.json'])('reports corrupt %s without replacing the original bytes in partial export', async (file) => {
    const { root, attempt } = await referencedRun();
    await writeFile(join(attempt, file), '{unfinished');
    await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
      .rejects.toThrow('unreadable');
    const output = join(root, 'partial');
    expect((await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output, allowPartial: true })).partial).toBe(true);
    expect(await readFile(join(output, 'tests/test-1/attempts/attempt-0', file), 'utf8')).toBe('{unfinished');
    await rm(root, { recursive: true, force: true });
  });

  it('keeps partial evidence explicitly partial even when every known file is present', async () => {
    const { root, runDir } = await referencedRun();
    const manifest = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
    manifest.evidenceStatus = 'partial';
    await writeFile(join(runDir, 'run.json'), JSON.stringify(manifest));
    await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'rejected') }))
      .rejects.toThrow('partial');
    expect((await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output: join(root, 'partial'), allowPartial: true })).partial).toBe(true);
    await rm(root, { recursive: true, force: true });
  });

  it.each(['timeline', 'trace', 'report'] as const)('reports escaping %s evidence without exporting outside files', async (location) => {
    const { root, runDir, attempt } = await referencedRun();
    const secret = join(root, 'outside.png');
    await writeFile(secret, 'outside');
    if (location === 'timeline') await writeFile(join(attempt, 'timeline.json'), JSON.stringify({ nodes: [{ artifacts: [{ path: secret }] }] }));
    if (location === 'trace') await writeFile(join(attempt, 'trace/trace.json'), JSON.stringify({ steps: [{ screenshotFile: secret }] }));
    if (location === 'report') await writeFile(join(runDir, 'report.json'), JSON.stringify({ artifacts: { screenshots: [secret] } }));
    const output = join(root, 'partial');
    const exported = await artifactsExportCommand({ runsRoot: root, runId: 'run-evidence', output, allowPartial: true });
    expect(exported.partial).toBe(true);
    expect(exported.missing.join(' ')).toContain('path escape');
    await expect(readFile(join(output, 'outside.png'))).rejects.toThrow();
    await rm(root, { recursive: true, force: true });
  });
  it('shows a run from run.json when report.json is absent and rejects incomplete export', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-artifacts-'));
    const runDir = join(root, 'run-1');
    await mkdir(join(runDir, 'tests/test-1/attempts/attempt-1'), { recursive: true });
    await writeFile(join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 1,
      runId: 'run-1',
      status: 'interrupted',
      evidenceStatus: 'partial',
      tests: [{ testId: 'test-1', attempts: [{ attemptId: 'attempt-1', resultPath: 'tests/test-1/attempts/attempt-1/result.json' }] }],
    }));
    const shown = await artifactsShowCommand({ runsRoot: root, runId: 'run-1' });
    expect(shown.report).toBeNull();
    await expect(artifactsExportCommand({ runsRoot: root, runId: 'run-1', output: join(root, 'export') }))
      .rejects.toThrow('report.json');
  });

  it('exports only manifest-listed files with allowPartial', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-artifacts-'));
    const runDir = join(root, 'run-2');
    await mkdir(join(runDir, 'tests/test-1/attempts/attempt-1'), { recursive: true });
    await writeFile(join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 1,
      runId: 'run-2',
      status: 'failed',
      evidenceStatus: 'partial',
      tests: [{ testId: 'test-1', attempts: [{ attemptId: 'attempt-1', resultPath: 'tests/test-1/attempts/attempt-1/result.json' }] }],
    }));
    await writeFile(join(runDir, 'tests/test-1/attempts/attempt-1/result.json'), '{}');
    await writeFile(join(runDir, 'ignored.tmp'), 'ignore');
    const result = await artifactsExportCommand({
      runsRoot: root,
      runId: 'run-2',
      output: join(root, 'export'),
      allowPartial: true,
    });
    expect(result.partial).toBe(true);
    await expect(readFile(join(root, 'export/tests/test-1/attempts/attempt-1/result.json'), 'utf8')).resolves.toBe('{}');
    await expect(readFile(join(root, 'export/ignored.tmp'), 'utf8')).rejects.toThrow();
  });

  it('exports the complete attempt directory and keeps relative evidence references usable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-artifacts-'));
    const runDir = join(root, 'run-3');
    const attemptDir = join(runDir, 'tests/test-1/attempts/attempt-1');
    await mkdir(join(attemptDir, 'trace', 'artifacts'), { recursive: true });
    await writeFile(join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 1,
      runId: 'run-3',
      status: 'failed',
      evidenceStatus: 'complete',
      tests: [{ testId: 'test-1', attempts: [{ attemptId: 'attempt-1', resultPath: 'tests/test-1/attempts/attempt-1/result.json' }] }],
    }));
    await writeFile(join(runDir, 'report.json'), '{}');
    await writeFile(join(attemptDir, 'result.json'), JSON.stringify({
      failureContextPath: 'failures.json',
    }));
    await writeFile(join(attemptDir, 'failures.json'), '[]');
    await writeFile(join(attemptDir, 'timeline.json'), '{"version":2}');
    await writeFile(join(attemptDir, 'trace', 'trace.json'), '{}');
    await writeFile(join(attemptDir, 'trace', 'artifacts', 'failure.png'), 'png');

    await artifactsExportCommand({ runsRoot: root, runId: 'run-3', output: join(root, 'export') });

    await expect(readFile(join(root, 'export/tests/test-1/attempts/attempt-1/failures.json'), 'utf8')).resolves.toBe('[]');
    await expect(readFile(join(root, 'export/tests/test-1/attempts/attempt-1/timeline.json'), 'utf8')).resolves.toContain('version');
    await expect(readFile(join(root, 'export/tests/test-1/attempts/attempt-1/trace/artifacts/failure.png'), 'utf8')).resolves.toBe('png');
  });

  it('does not copy files referenced by an escaping manifest path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fliwright-cli-artifacts-'));
    const runDir = join(root, 'run-4');
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'run.json'), JSON.stringify({
      schemaVersion: 1,
      runId: 'run-4',
      status: 'interrupted',
      evidenceStatus: 'partial',
      tests: [{ testId: 'escape', attempts: [{ attemptId: 'attempt-0', resultPath: '../outside/result.json' }] }],
    }));
    await mkdir(join(root, 'outside'), { recursive: true });
    await writeFile(join(root, 'outside', 'result.json'), '{}');

    const result = await artifactsExportCommand({
      runsRoot: root,
      runId: 'run-4',
      output: join(root, 'export'),
      allowPartial: true,
    });
    expect(result.partial).toBe(true);
    await expect(readFile(join(root, 'export', 'outside', 'result.json'), 'utf8')).rejects.toThrow();
  });
});
