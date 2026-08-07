import { describe, expect, it, vi } from 'vitest';
import { createServerState } from '../src/state.js';
import {
  DevAssistCycleParamsSchema,
  handleDevAssistCycle,
} from '../src/tools/devassist.js';

describe('fliwright_devassist_cycle', () => {
  it('validates its contract and delegates the complete request to the coordinator', async () => {
    const cycle = vi.fn(async () => ({
      status: 'needs_review' as const,
      devAssistSessionId: 'session-1',
      reason: 'A supported assertion could not be generated.',
    }));

    const result = await handleDevAssistCycle({
      request: 'Verify that Home opens Markets.',
      action: 'start',
      files: ['lib/home.dart'],
      target: 'lib/main.dart',
    }, createServerState(), () => ({ cycle }));

    expect(result).toEqual({
      status: 'needs_review',
      devAssistSessionId: 'session-1',
      reason: 'A supported assertion could not be generated.',
    });
    expect(cycle).toHaveBeenCalledWith({
      request: 'Verify that Home opens Markets.',
      action: 'start',
      files: ['lib/home.dart'],
      target: 'lib/main.dart',
    });
    expect(() => DevAssistCycleParamsSchema.parse({ action: 'continue' })).toThrow(/devAssistSessionId/i);
  });
});
