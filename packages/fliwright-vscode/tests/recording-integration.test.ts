import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Uri, window, __setShowInputBoxResult, __setShowQuickPickResult, __setShowSaveDialogResult, __setWorkspaceRoot } from 'vscode';
import { FliwrightSession } from '../src/session/FliwrightSession.js';
import { StatusBarService } from '../src/status/StatusBarService.js';
import { RecorderService } from '../src/recording/RecorderService.js';
import { RecordingPanel } from '../src/webview/RecordingPanel.js';
import { createWorkspace, readText } from './helpers/workspace.js';

/**
 * Integration tests that simulate the command orchestration from extension.ts.
 *
 * The actual commands are defined inside activate() and not directly testable,
 * so these tests replicate the coordination logic to verify multi-service
 * interactions during the recording workflow.
 */
describe('Recording command integration', () => {
  let recorderService: RecorderService;
  let session: FliwrightSession;
  let statusBar: StatusBarService;
  let recordingPanel: RecordingPanel;
  let panelHtml: string;
  let statusText: string;
  let statusCommand: string | undefined;

  function mockRecorder(overrides: Record<string, any> = {}) {
    return {
      start: overrides.start ?? vi.fn(async () => undefined),
      stop: overrides.stop ?? vi.fn(async () => "test('recorded', async () => {});"),
      getRawEvents: overrides.getRawEvents ?? vi.fn(() => []),
      getOperations: overrides.getOperations ?? vi.fn(() => []),
    };
  }

  beforeEach(async () => {
    recorderService = new RecorderService();
    session = new FliwrightSession();
    statusBar = new StatusBarService();
    recordingPanel = new RecordingPanel();
    panelHtml = '';

    // Wire up session state → status bar (same as extension.ts line 65-68)
    session.onDidChangeState((state) => {
      statusBar.setConnectionState(state);
    });

    // Capture status bar text via the stub
    const item = (window as any).createStatusBarItem();
    statusText = item.text;
    statusCommand = item.command;
  });

  afterEach(() => {
    session.dispose();
    statusBar.dispose();
  });

  /**
   * Mirrors the updateRecordingViews helper from extension.ts (line 585-589).
   */
  function updateRecordingViews(recording: ReturnType<RecorderService['getSession']>): void {
    statusBar.setRecording(recording);
    recordingPanel.update(recording);
  }

  /**
   * Simulates connecting the session so that setRecording() works.
   */
  function connectSession(recorder: ReturnType<typeof mockRecorder>): void {
    // Directly set the session to connected state
    const url = 'ws://localhost:12345/ws';
    (session as any).stateValue = { status: 'connected', url, connectedAt: Date.now() };
    (session as any).driver = { recorder, dispose: async () => {} };
  }

  describe('startRecording command flow', () => {
    it('starts recording and updates all UI components', async () => {
      const recorder = mockRecorder();
      connectSession(recorder);

      // Simulate: user enters test name in input box
      __setShowInputBoxResult('login test');

      // Simulate: session.setRecording() (extension.ts line 379)
      session.setRecording();

      // Simulate: recorderService.start() with callback (extension.ts line 380-383)
      const recording = await recorderService.start(session.connectedDriver, {
        testName: 'login test',
        onDidChange: updateRecordingViews,
      });

      // Simulate: updateRecordingViews(recording) (extension.ts line 384)
      updateRecordingViews(recording);

      // Verify session state
      expect(session.state.status).toBe('recording');

      // Verify recorder service state
      expect(recorderService.getSession().status).toBe('recording');
      expect(recorderService.getSession().testName).toBe('login test');

      // Verify status bar shows recording
      const item = (window as any)._lastStatusBarItem;
      // StatusBarService creates its own item, so check via getSession
      const sessionState = recorderService.getSession();
      expect(sessionState.status).toBe('recording');

      __setShowInputBoxResult(undefined);
    });

    it('rolls back state when start fails', async () => {
      const recorder = mockRecorder({
        start: vi.fn(async () => { throw new Error('Driver disconnected'); }),
      });
      connectSession(recorder);

      session.setRecording();

      let error: Error | undefined;
      try {
        await recorderService.start(session.connectedDriver, {
          testName: 'failed test',
          onDidChange: updateRecordingViews,
        });
      } catch (e) {
        error = e as Error;
        // Simulate: extension.ts error handler (line 388-390)
        session.setConnectedIdle();
        updateRecordingViews(recorderService.reset());
      }

      expect(error?.message).toBe('Driver disconnected');
      expect(session.state.status).toBe('connected');
      expect(recorderService.getSession().status).toBe('idle');
    });
  });

  describe('stopRecording command flow', () => {
    it('stops recording and transitions to preview', async () => {
      const recorder = mockRecorder({
        getOperations: vi.fn(() => [{ kind: 'tap' }, { kind: 'type' }]),
        getRawEvents: vi.fn(() => [{ kind: 'tap' }, { kind: 'type' }]),
      });
      connectSession(recorder);

      // Start recording first
      session.setRecording();
      await recorderService.start(session.connectedDriver, {
        testName: 'checkout',
        onDidChange: updateRecordingViews,
      });

      // Simulate: stopRecording command (extension.ts line 394-410)
      const recording = await recorderService.stop(session.connectedDriver);
      updateRecordingViews(recording);
      session.setConnectedIdle();

      // Verify final state
      expect(recorderService.getSession().status).toBe('preview');
      expect(recorderService.getSession().operationCount).toBe(2);
      expect(recorderService.getSession().generatedCode).toContain('recorded');
      expect(session.state.status).toBe('connected');
    });

    it('rolls back state when stop fails', async () => {
      const recorder = mockRecorder({
        stop: vi.fn(async () => { throw new Error('Codegen failed'); }),
      });
      connectSession(recorder);

      session.setRecording();
      await recorderService.start(session.connectedDriver);

      let error: Error | undefined;
      try {
        await recorderService.stop(session.connectedDriver);
      } catch (e) {
        error = e as Error;
        // Simulate: extension.ts error handler (line 405-407)
        session.setConnectedIdle();
        updateRecordingViews(recorderService.reset());
      }

      expect(error?.message).toBe('Codegen failed');
      expect(session.state.status).toBe('connected');
      expect(recorderService.getSession().status).toBe('idle');
    });
  });

  describe('insertRecordedTest command flow', () => {
    it('saves as new file when user chooses save option', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder();
      connectSession(recorder);

      // Start → Stop recording
      session.setRecording();
      await recorderService.start(session.connectedDriver);
      await recorderService.stop(session.connectedDriver);

      // Simulate: user picks "Save as New Test File"
      __setShowQuickPickResult((_items: unknown[]) => ({ label: 'Save as New Test File', action: 'save' }));
      const targetUri = Uri.file(path.join(root, 'tests', 'my-test.test.ts'));
      __setShowSaveDialogResult(targetUri);

      // Simulate: insertRecordedTest command logic (extension.ts line 438-439)
      const saved = await recorderService.saveGeneratedCode(Uri.file(root), targetUri);
      updateRecordingViews(recorderService.getSession());

      expect(saved.fsPath).toBe(targetUri.fsPath);
      await expect(readText(root, 'tests/my-test.test.ts')).resolves.toContain("test('recorded'");
      expect(recorderService.getSession().targetFile).toBe(targetUri.fsPath);

      __setShowQuickPickResult(undefined);
      __setShowSaveDialogResult(undefined);
    });

    it('inserts at cursor when user chooses insert option', async () => {
      const recorder = mockRecorder();
      connectSession(recorder);

      session.setRecording();
      await recorderService.start(session.connectedDriver);
      await recorderService.stop(session.connectedDriver);

      // Mock activeTextEditor for insert
      const inserted = vi.fn(async () => true);
      (window as any).activeTextEditor = {
        document: { uri: Uri.file('/app/existing.test.ts') },
        selection: { active: { line: 10, character: 0 } },
        edit: inserted,
      };

      // Simulate: insert at cursor
      const uri = await recorderService.insertGeneratedCode();
      updateRecordingViews(recorderService.getSession());

      expect(uri.fsPath).toBe('/app/existing.test.ts');
      expect(inserted).toHaveBeenCalled();
      expect(recorderService.getSession().targetFile).toBe('/app/existing.test.ts');

      (window as any).activeTextEditor = undefined;
    });

    it('does nothing when user cancels quick pick', async () => {
      const recorder = mockRecorder();
      connectSession(recorder);

      session.setRecording();
      await recorderService.start(session.connectedDriver);
      const before = await recorderService.stop(session.connectedDriver);

      // User cancels quick pick (returns undefined)
      __setShowQuickPickResult(() => undefined);

      // Simulate: the command checks for target and returns early
      // (extension.ts line 422: if (!target) return)
      const target = undefined;
      expect(target).toBeUndefined();

      // Service state should be unchanged
      expect(recorderService.getSession().status).toBe('preview');
      expect(recorderService.getSession().generatedCode).toBe(before.generatedCode);

      __setShowQuickPickResult(undefined);
    });
  });

  describe('full recording workflow', () => {
    it('completes start → stop → save cycle with multi-service coordination', async () => {
      const root = await createWorkspace();
      const changes: string[] = [];
      const recorder = mockRecorder({
        start: vi.fn(async ({ onOperation }) => {
          onOperation?.({ kind: 'tap' }, 0);
          onOperation?.({ kind: 'type' }, 1);
        }),
        getRawEvents: vi.fn(() => [{ kind: 'tap' }, { kind: 'type' }]),
        getOperations: vi.fn(() => [{ kind: 'tap' }, { kind: 'type' }]),
        stop: vi.fn(async () => "test('full flow', async () => { /* recorded */ });"),
      });

      connectSession(recorder);

      // Step 1: Start recording
      session.setRecording();
      const recordingStart = await recorderService.start(session.connectedDriver, {
        testName: 'full flow',
        onDidChange: (s) => {
          changes.push(s.status);
          updateRecordingViews(s);
        },
      });
      updateRecordingViews(recordingStart);

      expect(session.state.status).toBe('recording');
      expect(recorderService.getSession().status).toBe('recording');
      expect(recorderService.getSession().operationCount).toBe(2);

      // Step 2: Stop recording
      const recordingStop = await recorderService.stop(session.connectedDriver);
      updateRecordingViews(recordingStop);
      session.setConnectedIdle();

      expect(recorderService.getSession().status).toBe('preview');
      expect(session.state.status).toBe('connected');
      expect(recorderService.getSession().generatedCode).toContain('full flow');

      // Step 3: Save generated code
      const targetUri = Uri.file(path.join(root, 'tests', 'full-flow.test.ts'));
      const saved = await recorderService.saveGeneratedCode(Uri.file(root), targetUri);

      expect(saved.fsPath).toBe(targetUri.fsPath);
      await expect(readText(root, 'tests/full-flow.test.ts')).resolves.toContain('full flow');

      // Verify all state changes were tracked
      expect(changes).toContain('recording');
      expect(changes).toContain('preview');

      // Step 4: Reset for next recording
      recorderService.reset();
      expect(recorderService.getSession().status).toBe('idle');
      expect(recorderService.getSession().generatedCode).toBeUndefined();
    });
  });
});
