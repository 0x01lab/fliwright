import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { RecorderService } from '../src/recording/RecorderService.js';
import { createWorkspace, readText } from './helpers/workspace.js';

describe('RecorderService', () => {
  it('tracks recording state and generated code', async () => {
    const changes: string[] = [];
    const recorder = {
      start: vi.fn(async ({ onOperation }) => onOperation?.({ kind: 'tap' }, 0)),
      stop: vi.fn(async () => "test('recorded', async () => {});"),
      getRawEvents: vi.fn(() => [{ kind: 'tap' }]),
      getOperations: vi.fn(() => [{ kind: 'tap' }]),
    };
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
    const recorder = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => "test('recorded', async () => {});"),
      getRawEvents: vi.fn(() => []),
      getOperations: vi.fn(() => []),
    };
    const service = new RecorderService();
    await service.start({ recorder } as any);
    await service.stop({ recorder } as any);

    const saved = await service.saveGeneratedCode(Uri.file(root), Uri.file(path.join(root, 'tests', 'recorded.test.ts')));

    expect(saved.fsPath).toBe(path.join(root, 'tests', 'recorded.test.ts'));
    await expect(readText(root, 'tests/recorded.test.ts')).resolves.toContain("test('recorded'");
    expect(service.getSession().targetFile).toBe(saved.fsPath);
  });

  it('requires an active editor before inserting generated code', async () => {
    const recorder = {
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => "test('recorded', async () => {});"),
      getRawEvents: vi.fn(() => []),
      getOperations: vi.fn(() => []),
    };
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
