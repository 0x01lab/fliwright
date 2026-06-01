import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { RecorderService } from '../src/recording/RecorderService.js';

describe('RecorderService', () => {
  it('tracks recording state and generated code', async () => {
    const recorder = {
      start: vi.fn(async ({ onOperation }) => onOperation?.({ kind: 'tap' }, 0)),
      stop: vi.fn(async () => "test('recorded', async () => {});"),
      getRawEvents: vi.fn(() => [{ kind: 'tap' }]),
      getOperations: vi.fn(() => [{ kind: 'tap' }]),
    };
    const service = new RecorderService();

    await service.start({ recorder } as any);
    const stopped = await service.stop({ recorder } as any, Uri.file('/tmp/sample.test.ts'));

    expect(stopped.status).toBe('preview');
    expect(stopped.operationCount).toBe(1);
    expect(stopped.generatedCode).toContain('recorded');
  });
});
