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
}> = {}) {
  return {
    start: overrides.start ?? vi.fn(async () => undefined),
    stop: overrides.stop ?? vi.fn(async () => "test('recorded', async () => {});"),
    getRawEvents: overrides.getRawEvents ?? vi.fn(() => []),
    getOperations: overrides.getOperations ?? vi.fn(() => []),
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
      expect(changes).toEqual(['recording:0', 'recording:1', 'preview:1']);
      expect(recorder.stop).toHaveBeenCalledWith({ lang: 'ts', testName: 'checkout flow' });
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

      expect(service.reset()).toEqual({ status: 'idle', rawEventCount: 0, operationCount: 0 });
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
