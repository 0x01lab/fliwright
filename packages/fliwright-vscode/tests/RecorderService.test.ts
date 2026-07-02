import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Uri, window, workspace } from 'vscode';
import { AiRuntime, MockAiAdapter, type FliwrightFlowDocument } from '@fliwright/core';
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

    it('loads a standalone flow as a preview session', () => {
      const service = new RecorderService();
      const flow = flowEdit('manual checkout', [
        { id: 'screen-1', type: 'screen', title: 'Checkout', route: '/checkout' },
        { id: 'pay-action', type: 'action', title: 'Tap Pay', selector: 'text=Pay' },
      ], [
        { id: 'e1', source: 'screen-1', target: 'pay-action' },
      ]);

      const loaded = service.loadFlow(flow, Uri.file('/tmp/manual-checkout.flow.json'));

      expect(loaded).toEqual(expect.objectContaining({
        status: 'preview',
        rawEventCount: 0,
        operationCount: 2,
        testName: 'manual checkout',
        flow,
        flowFile: '/tmp/manual-checkout.flow.json',
      }));
      expect(service.getSession().flow?.id).toBe('flow-edit');
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
      expect(stopped.flowFile).toMatch(/\.fliwright\/flows\/flow-recording-\d+\.flow\.json$/);
      const relativeDir = stopped.recordingDir!.replace(`${root}/`, '');
      const manifest = JSON.parse(await readText(root, `${relativeDir}/recording.json`));
      expect(manifest).toEqual(expect.objectContaining({
        version: 1,
        testName: 'persisted flow',
        generatedCode: "test('recorded', async () => {});",
      }));
      expect(manifest.flow).toEqual(expect.objectContaining({
        version: 1,
        title: 'persisted flow',
        nodes: [expect.objectContaining({
          recordingFrameId: 'frame-1',
          screenshot: expect.objectContaining({
            source: 'recording-frame',
            recordingFrameId: 'frame-1',
            width: 100,
            height: 200,
          }),
        })],
      }));
      expect(manifest.flowFile).toBe(stopped.flowFile);
      const relativeFlowFile = service.getSession().flowFile!.replace(`${root}/`, '');
      const projectFlow = JSON.parse(await readText(root, relativeFlowFile));
      expect(projectFlow.nodes[0]).toEqual(expect.objectContaining({
        recordingFrameId: 'frame-1',
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
      expect(loaded.flow?.nodes[0].recordingFrameId).toBe('frame-1');
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
      expect(manifest.flow.nodes[0]).toEqual(expect.objectContaining({
        recordingFrameId: 'frame-1',
        operation: expect.objectContaining({
          status: 'included',
        }),
      }));
    });

    it('persists flow edits from the recording canvas', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any, { testName: 'flow edit' });
      const stopped = await service.stop({ recorder } as any, undefined, {}, Uri.file(root));

      const updated = await service.updateFlow({
        version: 1,
        id: 'flow-edit',
        title: 'flow edit',
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        source: { kind: 'manual', testName: 'flow edit' },
        nodes: [{
          id: 'note-1',
          type: 'note',
          title: 'Business note',
          notes: 'Explain this branch',
          position: { x: 10, y: 20 },
        }],
        edges: [],
      }, Uri.file(root));

      expect(updated.flow?.nodes[0]).toEqual(expect.objectContaining({
        id: 'note-1',
        notes: 'Explain this branch',
      }));
      expect(updated.flowFile).toMatch(/\.fliwright\/flows\/flow-edit\.flow\.json$/);
      const relativeDir = stopped.recordingDir!.replace(`${root}/`, '');
      const manifest = JSON.parse(await readText(root, `${relativeDir}/recording.json`));
      expect(manifest.flow.nodes[0]).toEqual(expect.objectContaining({
        id: 'note-1',
        type: 'note',
      }));
      const relativeFlowFile = updated.flowFile!.replace(`${root}/`, '');
      const projectFlow = JSON.parse(await readText(root, relativeFlowFile));
      expect(projectFlow.nodes[0]).toEqual(expect.objectContaining({
        id: 'note-1',
        notes: 'Explain this branch',
      }));
    });

    it('updates standalone flow files without creating recording manifests', async () => {
      const root = await createWorkspace();
      const service = new RecorderService();
      const flow = flowEdit('standalone flow');
      const flowUri = Uri.file(path.join(root, '.fliwright', 'flows', 'standalone.flow.json'));
      await workspace.fs.createDirectory(Uri.file(path.dirname(flowUri.fsPath)));
      await workspace.fs.writeFile(flowUri, Buffer.from(`${JSON.stringify(flow, null, 2)}\n`, 'utf8'));
      service.loadFlow(flow, flowUri);

      const updated = await service.updateFlow({
        ...flow,
        title: 'standalone flow updated',
        nodes: [{
          id: 'note-1',
          type: 'note',
          title: 'Standalone note',
          notes: 'Updated from Flow Studio',
        }],
      }, Uri.file(root));

      expect(updated.flowFile).toBe(flowUri.fsPath);
      expect(updated.recordingDir).toBeUndefined();
      const projectFlow = JSON.parse(await readText(root, '.fliwright/flows/standalone.flow.json'));
      expect(projectFlow.title).toBe('standalone flow updated');
      expect(projectFlow.nodes[0]).toEqual(expect.objectContaining({
        notes: 'Updated from Flow Studio',
      }));
      await expect(readText(root, '.fliwright/recordings/recording.json')).rejects.toThrow();
    });

    it('persists rapid flow edits in edit order', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any, { testName: 'flow edit race' });
      await service.stop({ recorder } as any, undefined, {}, Uri.file(root));

      const originalWriteFile = workspace.fs.writeFile.bind(workspace.fs);
      const originalCreateDirectory = workspace.fs.createDirectory.bind(workspace.fs);
      let releaseFirstFlowWrite: (() => void) | undefined;
      let markFirstFlowWriteStarted: (() => void) | undefined;
      let secondFlowWriteStarted = false;
      const firstFlowWriteStarted = new Promise<void>((resolve) => {
        markFirstFlowWriteStarted = resolve;
      });
      const createDirectory = vi.spyOn(workspace.fs, 'createDirectory').mockImplementation(async (uri) => {
        if (uri.fsPath.endsWith(`${path.sep}.fliwright${path.sep}flows`)) return;
        await originalCreateDirectory(uri);
      });
      const writeFile = vi.spyOn(workspace.fs, 'writeFile').mockImplementation(async (uri, bytes) => {
        const raw = Buffer.from(bytes).toString('utf8');
        if (
          uri.fsPath.endsWith(`${path.sep}.fliwright${path.sep}flows${path.sep}flow-edit.flow.json`)
          && raw.includes('"title": "first edit"')
        ) {
          markFirstFlowWriteStarted?.();
          await new Promise<void>((resolve) => {
            releaseFirstFlowWrite = resolve;
          });
        }
        if (
          uri.fsPath.endsWith(`${path.sep}.fliwright${path.sep}flows${path.sep}flow-edit.flow.json`)
          && raw.includes('"title": "second edit"')
        ) {
          secondFlowWriteStarted = true;
        }
        await originalWriteFile(uri, bytes);
      });

      try {
        const firstUpdate = service.updateFlow(flowEdit('first edit'), Uri.file(root));
        await firstFlowWriteStarted;
        const secondUpdate = service.updateFlow(flowEdit('second edit'), Uri.file(root));
        await Promise.resolve();
        await Promise.resolve();
        expect(secondFlowWriteStarted).toBe(false);
        releaseFirstFlowWrite?.();

        await Promise.all([firstUpdate, secondUpdate]);

        expect(service.getSession().flow?.title).toBe('second edit');
        const projectFlow = JSON.parse(await readText(root, '.fliwright/flows/flow-edit.flow.json'));
        expect(projectFlow.title).toBe('second edit');
        expect(projectFlow.nodes[0].title).toBe('second edit note');
      } finally {
        writeFile.mockRestore();
        createDirectory.mockRestore();
      }
    });

    it('previews AI flow cleaning without persisting changes', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any, { testName: 'flow clean preview' });
      const stopped = await service.stop({ recorder } as any, undefined, {}, Uri.file(root));
      const flow = flowEdit('flow clean preview', [
        { id: 'screen-1', type: 'screen', title: 'Checkout' },
        { id: 'tap-noise', type: 'action', title: 'Duplicate tap' },
      ], [
        { id: 'e1', source: 'screen-1', target: 'tap-noise' },
      ]);
      await service.updateFlow(flow, Uri.file(root));
      const aiRuntime = new AiRuntime({
        provider: 'mock',
        adapter: new MockAiAdapter([{
          text: JSON.stringify({ version: 1, keptNodeIds: ['screen-1'] }),
          json: { version: 1, keptNodeIds: ['screen-1'] },
        }]),
      });

      const result = await service.cleanFlow({ aiRuntime, apply: false }, Uri.file(root));

      expect(result.applied).toBe(false);
      expect(result.flow.nodes.map((node) => node.id)).toEqual(['screen-1']);
      expect(service.getSession().flow?.nodes.map((node) => node.id)).toEqual(['screen-1', 'tap-noise']);
      const relativeFlowFile = service.getSession().flowFile!.replace(`${root}/`, '');
      const projectFlow = JSON.parse(await readText(root, relativeFlowFile));
      expect(projectFlow.nodes.map((node: { id: string }) => node.id)).toEqual(['screen-1', 'tap-noise']);
    });

    it('applies AI flow cleaning and persists the cleaned flow', async () => {
      const root = await createWorkspace();
      const recorder = mockRecorder();
      const service = new RecorderService();
      await service.start({ recorder } as any, { testName: 'flow clean apply' });
      await service.stop({ recorder } as any, undefined, {}, Uri.file(root));
      await service.updateFlow(flowEdit('flow clean apply', [
        { id: 'screen-1', type: 'screen', title: 'Checkout' },
        { id: 'tap-noise', type: 'action', title: 'Duplicate tap' },
        { id: 'pay-action', type: 'action', title: 'Tap Pay' },
      ], [
        { id: 'e1', source: 'screen-1', target: 'tap-noise' },
        { id: 'e2', source: 'tap-noise', target: 'pay-action' },
      ]), Uri.file(root));
      const aiRuntime = new AiRuntime({
        provider: 'mock',
        adapter: new MockAiAdapter([{
          text: JSON.stringify({ version: 1, keptNodeIds: ['screen-1', 'pay-action'] }),
          json: { version: 1, keptNodeIds: ['screen-1', 'pay-action'] },
        }]),
      });

      const result = await service.cleanFlow({ aiRuntime, apply: true }, Uri.file(root));

      expect(result.applied).toBe(true);
      expect(service.getSession().flow?.nodes.map((node) => node.id)).toEqual(['screen-1', 'pay-action']);
      const relativeFlowFile = service.getSession().flowFile!.replace(`${root}/`, '');
      const projectFlow = JSON.parse(await readText(root, relativeFlowFile));
      expect(projectFlow.nodes.map((node: { id: string }) => node.id)).toEqual(['screen-1', 'pay-action']);
      expect(projectFlow.edges[0].metadata).toEqual(expect.objectContaining({
        cleaned: true,
        removedNodeIds: ['tap-noise'],
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

function flowEdit(
  title: string,
  nodes: FliwrightFlowDocument['nodes'] = [{
    id: 'note-1',
    type: 'note',
    title: `${title} note`,
    notes: title,
    position: { x: 10, y: 20 },
  }],
  edges: FliwrightFlowDocument['edges'] = [],
): FliwrightFlowDocument {
  return {
    version: 1,
    id: 'flow-edit',
    title,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z',
    source: { kind: 'manual', testName: title },
    nodes,
    edges,
  };
}
