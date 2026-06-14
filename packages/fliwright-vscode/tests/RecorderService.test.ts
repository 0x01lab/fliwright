import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Uri, window } from 'vscode';
import { RecorderService } from '../src/recording/RecorderService.js';
import { createWorkspace, readText } from './helpers/workspace.js';

function mockRecorder(overrides: Partial<{
  start: typeof vi.fn;
  stop: typeof vi.fn;
  getRawEvents: typeof vi.fn;
  getOperations: typeof vi.fn;
  getFrames: typeof vi.fn;
  setOperationIncluded: typeof vi.fn;
}> = {}) {
  return {
    start: overrides.start ?? vi.fn(async () => undefined),
    stop: overrides.stop ?? vi.fn(async () => "test('recorded', async () => {});"),
    getRawEvents: overrides.getRawEvents ?? vi.fn(() => []),
    getOperations: overrides.getOperations ?? vi.fn(() => []),
    getFrames: overrides.getFrames ?? vi.fn(() => []),
    setOperationIncluded: overrides.setOperationIncluded ?? vi.fn(() => "test('recorded', async () => {});"),
  };
}

describe('RecorderService', () => {
  describe('happy path', () => {
    it('tracks recording state and generated code', async () => {
      const changes: string[] = [];
      const recorder = mockRecorder({
        start: vi.fn(async ({ onOperation }) => onOperation?.({ kind: 'tap' }, 0)),
        stop: vi.fn(async () => "test('recorded', async () => {});"),
        getRawEvents: vi.fn(() => [{ kind: 'tap' }]),
        getOperations: vi.fn(() => [{ kind: 'tap' }]),
        getFrames: vi.fn(() => [{
          id: 'frame-1',
          index: 0,
          kind: 'tap',
          status: 'ready',
          timestamp: 1000,
          position: { x: 10, y: 20 },
        }]),
      });
      const service = new RecorderService();

      await service.start({ recorder } as any, {
        testName: 'checkout flow',
        onDidChange: (session) => changes.push(`${session.status}:${session.operationCount}`),
      });
      const stopped = await service.stop({ recorder } as any, Uri.file('/tmp/sample.test.ts'));

      expect(stopped.status).toBe('preview');
      expect(stopped.operationCount).toBe(1);
      expect(stopped.testName).toBe('checkout flow');
      expect(stopped.generatedCode).toContain('recorded');
      expect(stopped.frames).toHaveLength(1);
      expect(changes).toEqual(['recording:0', 'recording:1', 'preview:1']);
      expect(recorder.start).toHaveBeenCalledWith(expect.objectContaining({
        captureScreenshots: true,
        filterNoise: true,
        onOperation: expect.any(Function),
        onFrame: expect.any(Function),
      }));
      expect(recorder.stop).toHaveBeenCalledWith(expect.objectContaining({
        lang: 'ts',
        testName: 'checkout flow',
        resetToHomeBeforeEach: true,
        homeRoute: '/',
      }));
    });

    it('saves generated code to an explicit file', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any);
      await service.stop({ recorder } as any);

      const saved = await service.saveGeneratedCode(Uri.file(root), Uri.file(path.join(root, 'tests', 'recorded.test.ts')));

      expect(saved.fsPath).toBe(path.join(root, 'tests', 'recorded.test.ts'));
      await expect(readText(root, 'tests/recorded.test.ts')).resolves.toContain("test('recorded'");
      expect(service.getSession().targetFile).toBe(saved.fsPath);
    });

    it('requires an active editor before inserting generated code', async () => {
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any);
      await service.stop({ recorder } as any);

      await expect(service.insertGeneratedCode()).rejects.toThrow('Open a TypeScript test file');
    });

    it('resets to idle', async () => {
      const service = new RecorderService();

      expect(service.reset()).toEqual({ status: 'idle', rawEventCount: 0, operationCount: 0, frames: [] });
    });

    it('updates frame inclusion through the active recorder', async () => {
      const recorder = mockRecorder({
        getRawEvents: vi.fn(() => [{ kind: 'tap' }]),
        getOperations: vi.fn(() => [{ kind: 'tap', status: 'ignored' }]),
        getFrames: vi.fn(() => [{
          id: 'frame-1',
          index: 0,
          kind: 'tap',
          status: 'ready',
          timestamp: 1000,
          position: { x: 10, y: 20 },
          operationIndex: 0,
          operationStatus: 'included',
        }]),
        setOperationIncluded: vi.fn(() => "test('updated', async () => {});"),
      });
      const service = new RecorderService();
      await service.start({ recorder } as any);
      await service.stop({ recorder } as any);

      const updated = await service.setFrameIncluded({ recorder } as any, 'frame-1', true);

      expect(recorder.setOperationIncluded).toHaveBeenCalledWith(0, true);
      expect(updated.generatedCode).toContain('updated');
      expect(updated.frames?.[0]).toEqual(expect.objectContaining({
        id: 'frame-1',
        operationStatus: 'included',
      }));
    });
  });

  describe('insertGeneratedCode success path', () => {
    const originalEditor = window.activeTextEditor;

    afterEach(() => {
      (window as any).activeTextEditor = originalEditor;
    });

    it('inserts code at cursor and updates targetFile', async () => {
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any);
      await service.stop({ recorder } as any);

      const inserted = vi.fn(async () => true);
      (window as any).activeTextEditor = {
        document: { uri: Uri.file('/tmp/app.test.ts') },
        selection: { active: { line: 5, character: 0 } },
        edit: inserted,
      };

      const uri = await service.insertGeneratedCode();

      expect(uri.fsPath).toBe('/tmp/app.test.ts');
      expect(inserted).toHaveBeenCalled();
      expect(service.getSession().targetFile).toBe('/tmp/app.test.ts');
    });
  });

  describe('saveGeneratedCode', () => {
    it('throws when no code has been generated', async () => {
      const service = new RecorderService();

      await expect(service.saveGeneratedCode(Uri.file('/tmp'))).rejects.toThrow('Stop recording before saving');
    });

    it('generates a timestamped filename when targetFile is omitted', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any);
      await service.stop({ recorder } as any);

      const saved = await service.saveGeneratedCode(Uri.file(root));

      expect(saved.fsPath).toMatch(/tests\/recorded-\d+\.test\.ts$/);
      const written = await readText(root, saved.fsPath.replace(root + '/', ''));
      expect(written).toContain("test('recorded'");
      expect(service.getSession().targetFile).toBe(saved.fsPath);
    });
  });

  describe('recording persistence', () => {
    it('persists a recording manifest and frame screenshots on stop', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder({
        getRawEvents: vi.fn(() => [{ kind: 'tap' }]),
        getOperations: vi.fn(() => [{ kind: 'tap' }]),
        getFrames: vi.fn(() => [{
          id: 'frame-1',
          index: 0,
          kind: 'tap',
          status: 'ready',
          timestamp: 1000,
          position: { x: 10, y: 20 },
          operationIndex: 0,
          screenshot: {
            base64: Buffer.from('png-bytes').toString('base64'),
            format: 'png',
            width: 100,
            height: 200,
            pixelRatio: 1,
          },
        }]),
      });
      const service = new RecorderService();

      await service.start({ recorder } as any, { testName: 'persisted flow' });
      const stopped = await service.stop({ recorder } as any, undefined, {}, Uri.file(root));

      expect(stopped.recordingDir).toMatch(/\.fliwright\/recordings\/recording-\d+$/);
      const relativeDir = stopped.recordingDir!.replace(`${root}/`, '');
      const manifest = JSON.parse(await readText(root, `${relativeDir}/recording.json`));
      expect(manifest).toEqual(expect.objectContaining({
        version: 1,
        testName: 'persisted flow',
        generatedCode: "test('recorded', async () => {});",
      }));
      expect(manifest.frames[0]).toEqual(expect.objectContaining({
        id: 'frame-1',
        screenshotFile: 'screenshots/frame-0001.png',
        screenshot: { format: 'png', width: 100, height: 200, pixelRatio: 1 },
      }));
      await expect(readText(root, `${relativeDir}/screenshots/frame-0001.png`)).resolves.toBe('png-bytes');

      const recordings = await service.listPersistedRecordings(Uri.file(root));
      expect(recordings).toHaveLength(1);
      expect(recordings[0]).toEqual(expect.objectContaining({
        label: 'persisted flow',
      }));

      const loaded = await service.loadPersistedRecording(recordings[0].recordingDir);
      expect(loaded).toEqual(expect.objectContaining({
        status: 'preview',
        testName: 'persisted flow',
        generatedCode: "test('recorded', async () => {});",
      }));
      expect(loaded.frames?.[0].screenshot).toEqual({
        base64: Buffer.from('png-bytes').toString('base64'),
        format: 'png',
        width: 100,
        height: 200,
        pixelRatio: 1,
      });
    });

    it('updates the persisted manifest after manual frame filtering', async () => {
      const root = await createWorkspace();
      let included = false;
      const recorder = mockRecorder({
        getRawEvents: vi.fn(() => [{ kind: 'tap' }]),
        getOperations: vi.fn(() => [{ kind: 'tap', status: included ? 'included' : 'ignored' }]),
        getFrames: vi.fn(() => [{
          id: 'frame-1',
          index: 0,
          kind: 'tap',
          status: 'ready',
          timestamp: 1000,
          position: { x: 10, y: 20 },
          operationIndex: 0,
          operationStatus: included ? 'included' : 'ignored',
          ignoreReason: included ? undefined : 'nonActionable',
        }]),
        setOperationIncluded: vi.fn((_index, nextIncluded) => {
          included = nextIncluded;
          return "test('updated', async () => {});";
        }),
      });
      const service = new RecorderService();
      await service.start({ recorder } as any);
      const stopped = await service.stop({ recorder } as any, undefined, {}, Uri.file(root));

      await service.setFrameIncluded({ recorder } as any, 'frame-1', true, Uri.file(root));

      const relativeDir = stopped.recordingDir!.replace(`${root}/`, '');
      const manifest = JSON.parse(await readText(root, `${relativeDir}/recording.json`));
      expect(manifest.generatedCode).toContain('updated');
      expect(manifest.frames[0]).toEqual(expect.objectContaining({
        operationStatus: 'included',
      }));
    });
  });

  describe('error scenarios', () => {
    it('propagates start errors without corrupting state', async () => {
      const recorder = mockRecorder({
        start: vi.fn(async () => { throw new Error('VM service disconnected'); }),
      });
      const service = new RecorderService();

      await expect(service.start({ recorder } as any)).rejects.toThrow('VM service disconnected');
      expect(service.getSession().status).toBe('recording');
    });

    it('propagates stop errors', async () => {
      const recorder = mockRecorder({
        stop: vi.fn(async () => { throw new Error('Codegen failed'); }),
      });
      const service = new RecorderService();
      await service.start({ recorder } as any);

      await expect(service.stop({ recorder } as any)).rejects.toThrow('Codegen failed');
    });

    it('throws when inserting before stopping', async () => {
      const service = new RecorderService();

      await expect(service.insertGeneratedCode()).rejects.toThrow('Stop recording before inserting');
    });
  });

  describe('multiple start-stop cycles', () => {
    it('isolates state across cycles', async () => {
      const service = new RecorderService();

      // First cycle with tap operation
      const recorder1 = mockRecorder({
        start: vi.fn(async ({ onOperation }) => onOperation?.({ kind: 'tap' }, 0)),
        getRawEvents: vi.fn(() => [{ kind: 'tap' }]),
        getOperations: vi.fn(() => [{ kind: 'tap' }]),
        stop: vi.fn(async () => "test('first', async () => {});"),
      });
      await service.start({ recorder: recorder1 } as any);
      const first = await service.stop({ recorder: recorder1 } as any);

      expect(first.operationCount).toBe(1);
      expect(first.generatedCode).toContain('first');

      // Reset and second cycle
      service.reset();
      expect(service.getSession().status).toBe('idle');
      expect(service.getSession().generatedCode).toBeUndefined();

      const recorder2 = mockRecorder({
        getRawEvents: vi.fn(() => [{ kind: 'tap' }, { kind: 'tap' }]),
        getOperations: vi.fn(() => [{ kind: 'tap' }, { kind: 'drag' }]),
        stop: vi.fn(async () => "test('second', async () => {});"),
      });
      await service.start({ recorder: recorder2 } as any, { testName: 'second run' });
      const second = await service.stop({ recorder: recorder2 } as any);

      expect(second.operationCount).toBe(2);
      expect(second.testName).toBe('second run');
      expect(second.generatedCode).toContain('second');
      expect(second.generatedCode).not.toContain('first');
    });
  });
});
