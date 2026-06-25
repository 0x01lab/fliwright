import { AgentRepair, type RepairProposal, type RepairResult } from '@fliwright/core';
import type { Page } from '@fliwright/core';
import type {
  TddCycleResult,
  TddRepairPlan,
  TddRepairPlannerLike,
  TddRepairProposalEntry,
} from '../types.js';
import { buildTddFailureContext, type TddFailureContext } from '../diagnostics/TddFailureContext.js';

/**
 * Maps a red TDD cycle's failure context to a *candidate* minimal `AgentRepair` proposal. This is
 * deliberately heuristic and bounded: it only ever emits one of the runtime-action kinds the
 * AgentRepair guardrail already understands (click / wait / dismissModal / retryStep / observe), so
 * the guardrail can accept or reject each one deterministically. It never emits `codePatch` (the one
 * kind `AgentRepair.validate` always rejects as "cannot mutate source code") — keeping repairs
 * strictly runtime-side is the guardrail's invariant.
 *
 * The synthesizer is intentionally dumb on purpose: a real P3+ iteration would call an LLM here, but
 * the closed loop's safety does NOT depend on the synthesizer being smart — it depends on every
 * proposed action passing `AgentRepair.validate()` before it touches the app. An LLM-driven
 * synthesizer that emitted a `codePatch` or an unknown kind would simply be rejected, exactly like
 * the unit-tested unsafe-proposal case.
 */
function synthesizeCandidateProposal(failure: TddFailureContext | undefined): RepairProposal | null {
  if (!failure) return null;
  switch (failure.kind) {
    case 'missing-element':
    case 'ambiguous-element':
      // A common cause: a modal/overlay is in the way, or the element needs a beat to settle.
      return { kind: 'dismissModal' };
    case 'navigation-failed':
      return { kind: 'wait', ms: 250 };
    case 'timeout':
      // A retry is the safe, bounded response; the guardrail caps retries per step.
      return { kind: 'retryStep' };
    case 'mock-not-called':
    case 'state-mismatch':
    case 'wrong-text':
    case 'test-error':
    case 'disconnected':
      return null;
    default:
      return null;
  }
}

/**
 * Builds an agent-readable diff/patch string describing the proposed minimal fix. This is what
 * `suggest` mode returns for approval and what `safe-apply` records per iteration so the agent can
 * audit exactly which bounded runtime actions were applied.
 */
function describePlan(
  failure: TddFailureContext | undefined,
  entries: TddRepairProposalEntry[],
  appliedResults: RepairResult[] | undefined,
): string {
  const header = failure
    ? `# TDD repair proposal\n## Failure\n- kind: ${failure.kind}\n- message: ${failure.message}\n- test: ${failure.testFile}${failure.testName ? ` :: ${failure.testName}` : ''}\n`
    : `# TDD repair proposal\n## Failure\n- (no structured failure context)\n`;
  const lines: string[] = [header, '## Proposed actions'];
  if (entries.length === 0) {
    lines.push('- (no safe runtime action could be synthesized for this failure)');
  }
  for (const entry of entries) {
    const verdict = entry.safe ? 'SAFE' : `REJECTED${entry.reason ? ` (${entry.reason})` : ''}`;
    lines.push(`- [${verdict}] ${JSON.stringify(entry.proposal)}`);
  }
  if (appliedResults && appliedResults.length > 0) {
    lines.push('', '## Applied');
    for (const r of appliedResults) {
      lines.push(`- ${r.accepted ? 'accepted' : 'rejected'}: ${JSON.stringify(r.action)}${r.reason ? ` — ${r.reason}` : ''}`);
    }
  }
  return lines.join('\n');
}

export interface TddRepairPlannerOptions {
  /**
   * The `AgentRepair` instance backing the guardrail + safe-apply execution. In production this is
   * constructed with the runtime-owned `Page` (so click/dismissModal/wait act on the live app). The
   * guardrail (`validate`) is authoritative: nothing reaches the app unless it passes.
   */
  repair: AgentRepair;
  /**
   * Optional override of the candidate-proposal synthesizer. Tests inject a deterministic one; the
   * default maps failure kinds to bounded runtime actions (see {@link synthesizeCandidateProposal}).
   */
  synthesize?: (failure: TddFailureContext | undefined) => RepairProposal | null;
  /**
   * Stable step id passed to `AgentRepair.execute` so its per-step retry counter is meaningful across
   * loop iterations. Defaults to 'tdd-cycle'.
   */
  stepId?: string;
}

/**
 * Proposes a minimal, guardrail-bounded repair for a red TDD cycle, using `@fliwright/core`'s
 * {@link AgentRepair} as the safety authority. Two modes (design §7 P3):
 *
 * - `'suggest'` returns the plan (diff + per-proposal guardrail verdicts) and applies nothing. The
 *   caller (an agent) reviews the diff and decides.
 * - `'safe-apply'` applies only the proposals the AgentRepair `validate()` guard accepts (bounded
 *   runtime actions: click/wait/dismissModal/retryStep/observe) and returns their execute results.
 *   Source-mutating `codePatch` and unknown kinds are always rejected by the guardrail — the loop
 *   can never apply an unbounded edit.
 *
 * The planner never bypasses the guardrail: `validate()` is the single chokepoint. This keeps the
 * closed loop safe even if a future synthesizer is LLM-driven.
 */
export class TddRepairPlanner implements TddRepairPlannerLike {
  private readonly repair: AgentRepair;
  private readonly synthesize: (failure: TddFailureContext | undefined) => RepairProposal | null;
  private readonly stepId: string;

  constructor(options: TddRepairPlannerOptions) {
    this.repair = options.repair;
    this.synthesize = options.synthesize ?? synthesizeCandidateProposal;
    this.stepId = options.stepId ?? 'tdd-cycle';
  }

  /**
   * Convenience factory: builds an `AgentRepair` over the given page (the same page the runtime's
   * baseline reset uses) and wraps it. Pass the runtime-owned `Page` so safe-apply repairs act on
   * the live app the loop is driving.
   */
  static forPage(page: Page, options?: { maxRetriesPerStep?: number; synthesize?: TddRepairPlannerOptions['synthesize'] }): TddRepairPlanner {
    return new TddRepairPlanner({
      repair: new AgentRepair({ page, maxRetriesPerStep: options?.maxRetriesPerStep }),
      synthesize: options?.synthesize,
    });
  }

  async propose(
    result: TddCycleResult,
    mode: 'suggest' | 'safe-apply',
  ): Promise<TddRepairPlan & { applied?: RepairResult[] }> {
    const failure = result.failureContext ?? toFallbackFailure(result);
    const candidate = this.synthesize(failure);

    const proposals: TddRepairProposalEntry[] = [];
    if (candidate) {
      // The guardrail is authoritative: validate() returns null when the proposal is a bounded,
      // supported runtime action. A codePatch / unknown kind is rejected here regardless of source.
      const reason = this.repair.validate(candidate, this.stepId);
      proposals.push({ proposal: candidate, safe: reason === null, reason: reason ?? undefined });
    }

    let applied: RepairResult[] | undefined;
    if (mode === 'safe-apply') {
      applied = [];
      for (const entry of proposals) {
        if (!entry.safe) continue;
        // execute() re-validates and then applies via the page; capture its verdict for the trace.
        applied.push(await this.repair.execute(entry.proposal, this.stepId));
      }
      if (applied.length === 0) applied = undefined;
    }

    const diff = describePlan(failure, proposals, applied);
    return { mode, diff, proposals, applied };
  }
}

/** Builds a minimal failure context when a red result lacked a structured one (defensive). */
function toFallbackFailure(result: TddCycleResult): TddFailureContext {
  return buildTddFailureContext({
    file: result.file,
    testName: result.testName,
    message: result.failure?.message ?? 'Focused TDD test failed.',
  });
}
