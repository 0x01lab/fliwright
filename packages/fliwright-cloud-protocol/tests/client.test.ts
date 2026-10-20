import { expect, it } from 'vitest';
import { passesGitLabGate } from '../src/CloudClient.js';

it('requires the latest execution report, keeping publishing failures separate from a passed test verdict', () => {
  const request = {
    state: 'completed',
    verdict: 'passed',
    attempts: [
      {
        attemptId: 'old',
        outcome: { cleanup: 'clean', publication: 'published' },
      },
      {
        attemptId: 'latest',
        outcome: { cleanup: 'clean', publication: 'publish_failed' },
      },
    ],
    reports: [{ attemptId: 'old', state: 'published' }],
  };
  expect(passesGitLabGate(request)).toBe(false);
  request.reports.push({ attemptId: 'latest', state: 'published' });
  expect(passesGitLabGate(request)).toBe(true);
  expect(passesGitLabGate({ ...request, state: 'cancelled' })).toBe(false);
  expect(passesGitLabGate({ ...request, verdict: 'failed' })).toBe(false);
  request.attempts[1].outcome.cleanup = 'failed';
  expect(passesGitLabGate(request)).toBe(false);
});
