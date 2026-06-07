import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleSnap } from '../src/tools/snap.js';

describe('handleSnap', () => {
  it('throws when no driver is connected', async () => {
    const state = createServerState();

    await expect(handleSnap({}, state)).rejects.toThrow('fliwright_connect');
  });

  it('captures a snapshot from the connected driver', async () => {
    const state = createServerState();
    const snapshot = vi.fn().mockResolvedValue({
      snapshot: '- button "Submit" [ref=e1]\n',
      groupId: 'snapshot-1',
      refs: [{ ref: 'e1', role: 'button', label: 'Submit', type: 'Semantics' }],
      count: 1,
    });
    state.setDriver({
      page: { snapshot },
    } as unknown as FliwrightDriver);

    const result = await handleSnap(
      { depth: 3, includeRects: false, includeProperties: true },
      state,
    );

    expect(snapshot).toHaveBeenCalledWith({
      depth: 3,
      includeRects: false,
      includeProperties: true,
    });
    expect(result.refs[0].ref).toBe('e1');
  });
});
