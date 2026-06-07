import { describe, expect, it, vi } from 'vitest';
import type { FliwrightDriver } from '@fliwright/core';
import { createServerState } from '../src/state.js';
import { handleFind } from '../src/tools/find.js';
import { handleObserve } from '../src/tools/observe.js';

const refs = [
  {
    ref: 'e1',
    role: 'button',
    label: 'Submit',
    type: 'Semantics',
    key: 'submitButton',
    enabled: true,
  },
  {
    ref: 'e2',
    role: 'textbox',
    label: 'Email',
    type: 'TextField',
    enabled: true,
  },
  {
    ref: 'e3',
    role: 'text',
    label: 'Terms',
    type: 'Text',
  },
];

function stateWithSnapshot() {
  const state = createServerState();
  const snapshot = vi.fn().mockResolvedValue({
    snapshot: '',
    groupId: 'snapshot-1',
    refs,
    count: refs.length,
  });
  state.setDriver({
    page: { snapshot },
  } as unknown as FliwrightDriver);
  return { state, snapshot };
}

describe('handleFind', () => {
  it('throws when no driver is connected', async () => {
    await expect(handleFind({ text: 'Submit' }, createServerState())).rejects.toThrow(
      'fliwright_connect',
    );
  });

  it('filters snapshot refs by predicates', async () => {
    const { state } = stateWithSnapshot();

    const result = await handleFind({ containsText: 'Sub', role: 'button' }, state);

    expect(result.count).toBe(1);
    expect(result.matches[0].ref).toBe('e1');
  });
});

describe('handleObserve', () => {
  it('returns filtered actionable candidates', async () => {
    const { state, snapshot } = stateWithSnapshot();

    const result = await handleObserve({ roles: 'button,textbox', limit: 1 }, state);

    expect(snapshot).toHaveBeenCalledWith({
      includeRects: true,
      includeProperties: false,
    });
    expect(result.count).toBe(1);
    expect(result.candidates[0].ref).toBe('e1');
  });

  it('can include lightweight diagnostics', async () => {
    const { state } = stateWithSnapshot();

    const result = await handleObserve({
      intent: 'submit form',
      roles: 'button',
      includeDiagnostics: true,
    }, state);

    expect(result.candidates[0].diagnostics).toMatchObject({
      intent: 'submit form',
      enabled: true,
    });
  });
});
