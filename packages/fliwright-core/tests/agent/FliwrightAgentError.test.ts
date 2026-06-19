import { describe, expect, it } from 'vitest';
import { FliwrightAgentError, createAgentFailure } from '../../src/index.js';

describe('FliwrightAgentError', () => {
  it('preserves structured passive AI failure data', () => {
    const failure = createAgentFailure(new Error('No widget found'), 'Find username', 'step-1', 'selector_not_found');
    const error = new FliwrightAgentError(failure);

    expect(error.message).toContain('Find username');
    expect(error.message).toContain('[step-1]');
    expect(error.failure).toMatchObject({
      code: 'selector_not_found',
      timelineNodeId: 'step-1',
    });
    expect(error.failure.recoveryHints.map((hint) => hint.kind)).toContain('change-selector');
  });
});
