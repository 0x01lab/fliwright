import { describe, expect, it, vi, afterEach } from 'vitest';
import { Uri } from 'vscode';
import { readFile, writeFile } from 'node:fs/promises';
import { RecorderService, recordingEditorViewType } from '../src/recording/RecorderService.js';
import { createWorkspace, readText } from './helpers/workspace.js';
import { verifyRecordingReplay } from '@fliwright/cli/run';

vi.mock('@fliwright/cli/run', async (original) => ({ ...await original<typeof import('@fliwright/cli/run')>(),
  verifyRecordingReplay: vi.fn(async () => ({ passed: true, verifiedRunId: 'ide-replay', replayRunId: 'ide-replay', issues: [] })),
}));
afterEach(() => { vi.mocked(verifyRecordingReplay).mockClear(); vi.unstubAllEnvs(); });

function driver(resolved = true) {
  return { recorder: {
    getArtifactDirectory: () => undefined,
    start: vi.fn(),
    stop: vi.fn(async () => ({ status: 'captured', code: 'untrusted recorder output', frames: [], issues: [],
      operations: [{ kind: 'tap', position: { x: 1, y: 2 }, timestamp: 1 }], receivedSequences: [], missingSequences: [],
    })),
    getRawEventCount: () => 0,
    getSelectors: () => new Map(resolved ? [[0, { query: { match: { key: 'save' } }, ambiguous: false, matchCount: 1 }]] : []),
  } } as any;
}

describe('IDE recording readiness', () => {
  it('uses environment scenarios and configured directories when publishing recorded scripts', async () => {
    const root = Uri.file(await createWorkspace());
    await writeFile(root.fsPath + '/fliwright.config.ts', `export default { paths: {
      scripts: 'qa/tasks', recordings: 'qa/captures', flows: 'qa/flows'
    } };`);
    vi.stubEnv('FLIWRIGHT_SCENARIOS', JSON.stringify({ saved: { name: 'saved', layers: [] } }));
    const service = new RecorderService();
    const app = driver();
    await service.start(app);
    const result = await service.stop(app, undefined, { scenarioName: 'saved' }, root);
    expect(result.readiness?.readiness).toBe('generated');
    const saved = await service.saveGeneratedCode(root);
    expect(saved.fsPath).toMatch(/qa\/tasks\/.+\.script\.ts$/);
    expect(service.getSession().recordingDir).toContain('/qa/captures/');
    expect(service.getSession().flowFile).toContain('/qa/flows/');
  });

  it('applies matching Dart compile/run evidence and persists the verified state', async () => {
    const root = Uri.file(await createWorkspace());
    const service = new RecorderService();
    const app = driver();
    await service.start(app);
    await service.stop(app, undefined, { lang: 'dart', mode: 'script',
      dartAppEntrypoint: 'package:form_demo/recording_replay_main.dart' }, root);
    const generated = service.getSession();
    const evidenceFile = Uri.joinPath(root, 'verification.json');
    await writeFile(evidenceFile.fsPath, JSON.stringify({
      status: 'passed', runId: 'ide-dart-run', contentFingerprint: generated.readiness!.contentFingerprint!,
      appEntrypoint: 'package:form_demo/recording_replay_main.dart', platform: 'macos',
    }));
    const verified = await service.importDartVerification(root, evidenceFile);
    expect(verified.readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'ide-dart-run' });
    const loaded = await service.loadPersistedRecording(Uri.file(verified.recordingDir!));
    expect(loaded.readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'ide-dart-run' });
    await writeFile(evidenceFile.fsPath, '{"status":"passed","runId":42}');
    await expect(service.importDartVerification(root, evidenceFile)).rejects.toThrow(/invalid Dart verification evidence/i);
    expect(service.getSession().readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'ide-dart-run' });
    const dialog = await service.getGeneratedCodeSaveOptions(root);
    expect(dialog.defaultUri?.fsPath).toMatch(/\.dart$/);
    expect(dialog.filters).toEqual({ Dart: ['dart'] });
    const saved = await service.saveGeneratedCode(root);
    expect(saved.fsPath).toMatch(/\.dart$/);
    expect(recordingEditorViewType(saved.fsPath)).toBe('default');
    expect(recordingEditorViewType('recorded.test.ts')).toBe('fliwright.testEditor');
    expect(await readFile(saved.fsPath, 'utf8')).toBe(generated.generatedCode);
    await expect(service.saveGeneratedCode(root, Uri.joinPath(root, 'incorrect.script.ts')))
      .rejects.toThrow(/\.dart file/);
    expect(service.getSession().readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'ide-dart-run' });

    const failed = await service.applyDartVerification(root, {
      status: 'failed', runId: 'ide-dart-failed', contentFingerprint: generated.readiness!.contentFingerprint!,
      appEntrypoint: 'package:form_demo/recording_replay_main.dart', platform: 'macos', issues: [],
    });
    expect(failed.readiness?.readiness).toBe('draft');
    expect(failed.readiness?.verifiedRunId).toBeUndefined();
    expect(failed.readiness?.issues.join(' ')).toMatch(/compilation or replay failed/i);
    const reloaded = await service.loadPersistedRecording(Uri.file(failed.recordingDir!));
    expect(reloaded.readiness?.readiness).toBe('draft');
    expect(reloaded.readiness?.verifiedRunId).toBeUndefined();
    await expect(service.saveGeneratedCode(root)).rejects.toThrow(/compilation or replay failed/i);
  });
  it('keeps failed replay as a draft during save and allows an explicit replay retry', async () => {
    const root = Uri.file(await createWorkspace());
    await writeFile(root.fsPath + '/fliwright.config.ts', `export default { scenarios: { saved: { name: 'saved', layers: [] } } };`);
    const service = new RecorderService();
    const app = driver();
    await service.start(app);
    await service.stop(app, undefined, { scenarioName: 'saved' }, root);
    vi.mocked(verifyRecordingReplay).mockResolvedValueOnce({ passed: false, replayRunId: 'failed-replay', issues: ['replay failed'] });
    await service.verifyRecording(root, 'ws://vm');
    await expect(service.saveGeneratedCode(root)).rejects.toThrow(/replay failed/);
    expect((await service.verifyRecording(root, 'ws://vm')).readiness?.readiness).toBe('verified');
  });

  it('does not attach a completed verification to edits made while replay was running', async () => {
    const root = Uri.file(await createWorkspace());
    await writeFile(root.fsPath + '/fliwright.config.ts', `export default { scenarios: { saved: { name: 'saved', layers: [] } } };`);
    const service = new RecorderService();
    const app = driver();
    await service.start(app);
    await service.stop(app, undefined, { scenarioName: 'saved' }, root);
    let finish!: (value: Awaited<ReturnType<typeof verifyRecordingReplay>>) => void;
    vi.mocked(verifyRecordingReplay).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = service.verifyRecording(root, 'ws://vm');
    await vi.waitFor(() => expect(finish).toBeDefined());
    await service.reviewAutomation(root, { resetToHomeBeforeEach: false });
    finish({ passed: true, verifiedRunId: 'old-source', replayRunId: 'old-source', issues: [] });
    const result = await pending;
    expect(result.readiness?.verifiedRunId).toBeUndefined();
    expect(result.readiness?.readiness).toBe('generated');
  });
  it('generates a script through the shared core gate and uses the script directory', async () => {
    const root = Uri.file(await createWorkspace());
    const service = new RecorderService();
    const app = driver();
    await service.start(app);
    const result = await service.stop(app, undefined, {}, root);
    expect(result.readiness).toMatchObject({ readiness: 'generated', automationKind: 'script' });
    expect(result.generatedCode).toContain("script('recorded test'");
    const saved = await service.saveGeneratedCode(root);
    expect(saved.fsPath).toMatch(/\.fliwright\/scripts\/.+\.script\.ts$/);
  });

  it('persists unresolved capture as draft and refuses publication', async () => {
    const root = Uri.file(await createWorkspace());
    const service = new RecorderService();
    const app = driver(false);
    await service.start(app);
    const result = await service.stop(app, undefined, {}, root);
    expect(result.readiness?.readiness).toBe('draft');
    await expect(service.saveGeneratedCode(root)).rejects.toThrow(/unresolved target/i);
    expect(await readText(root.fsPath, '.fliwright/recordings/' + result.recordingId + '/recording.json')).toContain('unresolved target');
  });

  it('confirms a checkpoint, replays, and invalidates verification after the scenario changes', async () => {
    const root = Uri.file(await createWorkspace());
    const config = root.fsPath + '/fliwright.config.ts';
    await writeFile(config, `export default { scenarios: { saved: { name: 'saved', layers: [] } } };`);
    const service = new RecorderService();
    const app = driver();
    await service.start(app);
    await service.stop(app, undefined, {}, root);
    const reviewed = await service.reviewAutomation(root, { mode: 'test', scenarioName: 'saved',
      checkpoints: [{ id: 'saved', query: { match: { key: 'result' } }, matcher: 'toHaveText',
        expected: 'Saved', source: 'snapshot', confirmed: true }],
    });
    expect(reviewed.generatedCode).toContain("test.scenario('saved')");
    expect(reviewed.readiness?.readiness).toBe('generated');
    const verified = await service.verifyRecording(root, 'ws://vm');
    expect(verifyRecordingReplay).toHaveBeenCalledWith(expect.objectContaining({ code: reviewed.generatedCode }));
    expect(verified.readiness?.verifiedRunId).toBe('ide-replay');
    await writeFile(config, `export default { scenarios: { saved: { name: 'saved', layers: [{ kind: 'navigation', route: '/other' }] } } };`);
    const saved = await service.saveGeneratedCode(root);
    expect(saved.fsPath).toMatch(/\.fliwright\/tests\/.+\.test\.ts$/);
    expect(service.getSession().readiness?.readiness).toBe('generated');
    expect(service.getSession().readiness?.verifiedRunId).toBeUndefined();
  });

  it('persists checkpoint edits and keeps unconfirmed candidates out of generated assertions', async () => {
    const root = Uri.file(await createWorkspace());
    await writeFile(root.fsPath + '/fliwright.config.ts', `export default { scenarios: { saved: { name: 'saved', layers: [] } } };`);
    const service = new RecorderService();
    const app = driver();
    await service.start(app);
    await service.stop(app, undefined, {}, root);

    const draft = await service.reviewAutomation(root, { mode: 'test', scenarioName: 'saved', checkpoints: [{
      id: 'saved', query: { match: { key: 'result' } }, matcher: 'toHaveText', expected: 'Saved', source: 'snapshot', confirmed: false,
    }] });
    expect(draft.generatedCode).not.toContain('toHaveText');
    expect(draft.readiness?.readiness).toBe('draft');

    const reviewed = await service.reviewAutomation(root, { mode: 'test', scenarioName: 'saved', checkpoints: [{
      id: 'saved', query: { match: { key: 'result' } }, matcher: 'toHaveText', expected: 'Updated', source: 'snapshot', confirmed: true,
    }] });
    expect(reviewed.generatedCode).toContain('Updated');
    expect(reviewed.readiness?.readiness).toBe('generated');
    const loaded = await service.loadPersistedRecording(Uri.file(reviewed.recordingDir!));
    expect(loaded.checkpoints?.[0]).toMatchObject({ expected: 'Updated', confirmed: true });
    expect(loaded.generatedCode).toContain('Updated');
  });

  it('invalidates a verified recording when a loaded checkpoint target is edited', async () => {
    const root = Uri.file(await createWorkspace());
    await writeFile(root.fsPath + '/fliwright.config.ts', `export default { scenarios: { saved: { name: 'saved', layers: [] } } };`);
    const source = new RecorderService();
    const app = driver();
    await source.start(app);
    await source.stop(app, undefined, {}, root);
    const reviewed = await source.reviewAutomation(root, { mode: 'test', scenarioName: 'saved', checkpoints: [{
      id: 'saved', query: { match: { key: 'result' } }, matcher: 'toHaveText', expected: 'Saved', source: 'snapshot', confirmed: true,
    }] });
    const verified = await source.verifyRecording(root, 'ws://vm');
    expect(verified.readiness).toMatchObject({ readiness: 'verified', verifiedRunId: 'ide-replay' });

    const loadedService = new RecorderService();
    await loadedService.loadPersistedRecording(Uri.file(verified.recordingDir!));
    const edited = await loadedService.reviewAutomation(root, {
      ...loadedService.getSession().generationOptions,
      mode: 'test',
      scenarioName: 'saved',
      checkpoints: [{
        id: 'saved', query: { match: { semanticIdentifier: 'result-status' } }, matcher: 'toHaveText', expected: 'Updated', source: 'snapshot', confirmed: true,
      }],
    });

    expect(edited.generatedCode).toContain('result-status');
    expect(edited.generatedCode).toContain('Updated');
    expect(edited.readiness?.readiness).toBe('generated');
    expect(edited.readiness?.verifiedRunId).toBeUndefined();
    expect(edited.checkpoints?.[0]).toMatchObject({
      query: { match: { semanticIdentifier: 'result-status' } },
      expected: 'Updated',
      confirmed: true,
    });
    const persisted = JSON.parse(await readText(root.fsPath, `${edited.recordingDir!.replace(`${root.fsPath}/`, '')}/recording.json`));
    expect(persisted.readiness).toMatchObject({ readiness: 'generated' });
    expect(persisted.readiness.verifiedRunId).toBeUndefined();
    expect(reviewed.readiness?.verifiedRunId).toBeUndefined();
  });
});
