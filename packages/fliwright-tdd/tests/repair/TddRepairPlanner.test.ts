import { describe, expect, it, vi } from 'vitest';
import { AgentRepair, type RepairProposal } from '@fliwright/core';
import { TddRepairPlanner } from '../../src/repair/TddRepairPlanner.js';
import { buildTddFailureContext } from '../../src/diagnostics/TddFailureContext.js';
import type { TddCycleResult } from '../../src/types.js';

function redResult(message: string, kind?: Parameters<typeof buildTddFailureContext>[0]['kind']): TddCycleResult {
  const failureContext = buildTddFailureContext({
    file: '/app/sample.test.ts',
    testName: 'alpha',
    message,
    kind,
  });
  return {
    status: 'red',
    testName: 'alpha',
    file: '/app/sample.test.ts',
    durationMs: 5,
    lastSync: 'none',
    baselineVersion: 1,
    failure: { message },
    failureContext,
  };
}

describe('TddRepairPlanner', () => {
  describe('suggest mode', () => {
    it('proposes a safe runtime action and applies nothing', async () => {
      const page = { dismissModal: vi.fn(async () => {}) } as any;
      const planner = TddRepairPlanner.forPage(page);

      const plan = await planner.propose(redResult('No widget found matching selector'), 'suggest');

      expect(plan.mode).toBe('suggest');
      expect(plan.proposals).toHaveLength(1);
      expect(plan.proposals[0].safe).toBe(true);
      expect(plan.proposals[0].proposal).toMatchObject({ kind: 'dismissModal' });
      // suggest never applies.
      expect(plan.applied).toBeUndefined();
      expect(page.dismissModal).not.toHaveBeenCalled();
      expect(plan.diff).toContain('SAFE');
      expect(plan.diff).toContain('dismissModal');
    });

    it('rejects a source-mutating codePatch proposal via the guardrail', async () => {
      // A synthesizer that (maliciously or via an LLM) proposes a code edit. The guardrail must
      // reject it as unsafe regardless — the closed loop can never apply an unbounded edit.
      const unsafeSynthesizer = (): RepairProposal => ({ kind: 'codePatch', patch: 'diff --git a/lib/x.dart' });
      const page = { dismissModal: vi.fn(async () => {}) } as any;
      const planner = new TddRepairPlanner({
        repair: new AgentRepair({ page }),
        synthesize: unsafeSynthesizer,
      });

      const plan = await planner.propose(redResult('No widget found'), 'suggest');

      expect(plan.proposals).toHaveLength(1);
      expect(plan.proposals[0].safe).toBe(false);
      expect(plan.proposals[0].reason).toMatch(/cannot mutate source code/i);
      expect(plan.applied).toBeUndefined();
      expect(page.dismissModal).not.toHaveBeenCalled();
      expect(plan.diff).toContain('REJECTED');
    });

    it('rejects an unknown-kind proposal via the guardrail', async () => {
      const unknownSynthesizer = (): RepairProposal => ({ kind: 'deleteFile', path: '/app/lib/x.dart' } as RepairProposal);
      const planner = new TddRepairPlanner({
        repair: new AgentRepair({}),
        synthesize: unknownSynthesizer,
      });

      const plan = await planner.propose(redResult('boom'), 'suggest');

      expect(plan.proposals[0].safe).toBe(false);
      expect(plan.proposals[0].reason).toMatch(/unsupported repair action/i);
    });

    it('emits no proposals when the synthesizer has no candidate for the failure', async () => {
      const planner = new TddRepairPlanner({ repair: new AgentRepair({}) });
      // mock-not-called failures synthesize to null.
      const plan = await planner.propose(redResult('mock was not called', 'mock-not-called'), 'suggest');

      expect(plan.proposals).toHaveLength(0);
      expect(plan.diff).toContain('no safe runtime action');
    });
  });

  describe('safe-apply mode', () => {
    it('applies a safe proposal via the page and records the execute result', async () => {
      const dismissModal = vi.fn(async () => {});
      const page = { dismissModal } as any;
      const planner = TddRepairPlanner.forPage(page);

      const plan = await planner.propose(redResult('No widget found'), 'safe-apply');

      expect(plan.applied).toHaveLength(1);
      expect(plan.applied![0].accepted).toBe(true);
      expect(plan.applied![0].action).toMatchObject({ kind: 'dismissModal' });
      expect(dismissModal).toHaveBeenCalledTimes(1);
    });

    it('does not apply a rejected proposal and records nothing in applied', async () => {
      const unsafeSynthesizer = (): RepairProposal => ({ kind: 'codePatch', patch: 'p' });
      const page = { dismissModal: vi.fn(async () => {}) } as any;
      const planner = new TddRepairPlanner({
        repair: new AgentRepair({ page }),
        synthesize: unsafeSynthesizer,
      });

      const plan = await planner.propose(redResult('No widget found'), 'safe-apply');

      // The guardrail rejected it → nothing applied, page untouched.
      expect(plan.applied).toBeUndefined();
      expect(page.dismissModal).not.toHaveBeenCalled();
      expect(plan.proposals[0].safe).toBe(false);
    });

    it('uses the wired step id for the retry counter so retries are bounded across calls', async () => {
      // retryStep proposals share a stepId; the AgentRepair guard caps them at maxRetriesPerStep.
      const timeoutSynth = (): RepairProposal => ({ kind: 'retryStep' });
      const planner = new TddRepairPlanner({
        repair: new AgentRepair({ maxRetriesPerStep: 1 }),
        synthesize: timeoutSynth,
        stepId: 'tdd-test',
      });
      const timeoutResult = redResult('timed out', 'timeout');

      const first = await planner.propose(timeoutResult, 'safe-apply');
      const second = await planner.propose(timeoutResult, 'safe-apply');

      expect(first.proposals[0].safe).toBe(true);
      // Second call hits the per-step retry cap → guard rejects.
      expect(second.proposals[0].safe).toBe(false);
      expect(second.proposals[0].reason).toMatch(/retry limit/i);
    });
  });
});
