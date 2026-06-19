import { describe, expect, it, vi } from 'vitest';
import { AgentRepair, TimelineRecorder, type Page } from '../../src/index.js';

describe('AgentRepair', () => {
  it('rejects code patch proposals', async () => {
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'repair test' });
    const repair = new AgentRepair({ recorder });

    const result = await repair.execute({ kind: 'codePatch', patch: 'diff' });

    expect(result).toMatchObject({
      accepted: false,
      reason: 'Runtime repair cannot mutate source code.',
    });
    expect(recorder.toJSON().nodes[0]).toMatchObject({
      kind: 'ai-call',
      status: 'skipped',
      metadata: { accepted: false },
    });
  });

  it('executes safe dismiss modal repair', async () => {
    const page = {
      dismissModal: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const recorder = new TimelineRecorder({ runId: 'run-1', testName: 'repair test' });
    const repair = new AgentRepair({ page, recorder });

    const result = await repair.execute({ kind: 'dismissModal' });

    expect(result.accepted).toBe(true);
    expect(page.dismissModal).toHaveBeenCalled();
    expect(recorder.toJSON().nodes[0]).toMatchObject({
      status: 'passed',
      metadata: { accepted: true },
    });
  });

  it('guards retry loops per step', async () => {
    const repair = new AgentRepair({ maxRetriesPerStep: 1 });

    await expect(repair.execute({ kind: 'retryStep' }, 'step-1')).resolves.toMatchObject({ accepted: true });
    await expect(repair.execute({ kind: 'retryStep' }, 'step-1')).resolves.toMatchObject({
      accepted: false,
      reason: 'Retry limit reached for step-1',
    });
  });
});
