import { describe, expect, it } from 'vitest';
import { FlowRuntime, TimelineRecorder } from '../../src/index.js';
import type { TimelineData } from '../../src/index.js';

describe('Timeline node persistence', () => {
  it('flushes an independent step start before its body and its end before returning', async () => {
    const saved: TimelineData[] = [];
    const recorder = new TimelineRecorder({ runId: 'r', testName: 'independent flow',
      onChange: async (data) => {
        await new Promise((resolve) => setImmediate(resolve));
        saved.push(data);
      },
    });
    const flow = new FlowRuntime({ recorder });
    await flow.step('Save business state', async () => {
      expect(saved.at(-1)?.nodes[0]).toMatchObject({ title: 'Save business state', status: 'running' });
    });
    expect(saved.at(-1)?.nodes[0].status).toBe('passed');
    expect(saved[0].nodes[0].status).toBe('running');
  });

  it('keeps mutation snapshots ordered and isolated, and recovers after a sink failure', async () => {
    const saved: TimelineData[] = [];
    const errors: unknown[] = [];
    let writes = 0;
    const recorder = new TimelineRecorder({ runId: 'r', testName: 'snapshot ownership',
      onChange: async (data) => {
        if (++writes === 2) throw new Error('disk unavailable');
        saved.push(data);
      },
      onPersistenceError: (error) => { errors.push(error); },
    });
    const node = recorder.startNode('mock', 'Route', { metadata: { nested: { value: 1 } } });
    recorder.addArtifacts(node.id, [{ kind: 'snapshot', path: 'saved.json', metadata: { value: 1 } }]);
    recorder.passNode(node.id);
    (node.metadata!.nested as { value: number }).value = 2;
    node.artifacts![0].metadata!.value = 2;
    await recorder.flushProgress();
    expect(errors).toHaveLength(1);
    expect(saved.map((data) => data.nodes[0].status)).toEqual(['running', 'passed']);
    expect(saved[0].nodes[0].metadata).toEqual({ nested: { value: 1 } });
    expect(saved[1].nodes[0].artifacts?.[0].metadata).toEqual({ value: 1 });
  });

  it('preserves the operation error when progress persistence fails', async () => {
    const errors: unknown[] = [];
    const recorder = new TimelineRecorder({ runId: 'r', testName: 'failed flow',
      onChange: async () => { throw new Error('disk unavailable'); },
      onPersistenceError: (error) => { errors.push(error); },
    });
    const flow = new FlowRuntime({ recorder });
    await expect(flow.step('Broken', () => { throw new Error('business failure'); })).rejects.toThrow('business failure');
    expect(errors).toHaveLength(2);
    expect(recorder.toJSON().nodes[0].status).toBe('failed');
  });
});
