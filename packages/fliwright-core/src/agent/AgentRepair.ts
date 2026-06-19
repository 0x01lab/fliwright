import type { Page } from '../Page.js';
import { TimelineRecorder } from '../timeline/TimelineRecorder.js';

export type SafeRepairAction =
  | { kind: 'click'; key?: string; text?: string; ref?: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'dismissModal' }
  | { kind: 'retryStep' }
  | { kind: 'observe' };

export type RepairProposal =
  | SafeRepairAction
  | { kind: 'codePatch'; patch: string }
  | { kind: string; [key: string]: unknown };

export interface AgentRepairOptions {
  page?: Page;
  recorder?: TimelineRecorder;
  maxRetriesPerStep?: number;
}

export interface RepairResult {
  accepted: boolean;
  action: RepairProposal;
  reason?: string;
}

export class AgentRepair {
  private retries = new Map<string, number>();

  constructor(private readonly options: AgentRepairOptions = {}) {}

  async execute(action: RepairProposal, stepId = 'default'): Promise<RepairResult> {
    const node = this.options.recorder?.startNode('ai-call', `Repair: ${action.kind}`, {
      metadata: { mode: 'runtime-repair', proposal: redactProposal(action) },
    });
    const rejection = this.validate(action, stepId);
    if (rejection) {
      if (node) {
        this.options.recorder?.skipNode(node.id, {
          accepted: false,
          reason: rejection,
        });
      }
      return { accepted: false, action, reason: rejection };
    }

    try {
      await this.apply(action as SafeRepairAction);
      if (node) this.options.recorder?.passNode(node.id, { accepted: true });
      return { accepted: true, action };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (node) {
        this.options.recorder?.failNode(node.id, {
          code: 'step_failed',
          title: `Repair: ${action.kind}`,
          message: reason,
          timelineNodeId: node.id,
          recoveryHints: [
            { kind: 'manual', description: 'Inspect the failed repair action before retrying.' },
          ],
        });
      }
      return { accepted: false, action, reason };
    }
  }

  validate(action: RepairProposal, stepId = 'default'): string | null {
    if (action.kind === 'codePatch') return 'Runtime repair cannot mutate source code.';
    if (!['click', 'wait', 'dismissModal', 'retryStep', 'observe'].includes(action.kind)) {
      return `Unsupported repair action: ${action.kind}`;
    }
    if (action.kind === 'retryStep') {
      const count = this.retries.get(stepId) ?? 0;
      const max = this.options.maxRetriesPerStep ?? 2;
      if (count >= max) return `Retry limit reached for ${stepId}`;
      this.retries.set(stepId, count + 1);
    }
    if (action.kind === 'click' && !action.key && !action.text && !action.ref) {
      return 'Click repair requires key, text, or ref.';
    }
    if (action.kind === 'wait' && (!('ms' in action) || typeof action.ms !== 'number' || !Number.isFinite(action.ms) || action.ms < 0)) {
      return 'Wait repair requires a non-negative millisecond duration.';
    }
    return null;
  }

  private async apply(action: SafeRepairAction): Promise<void> {
    const page = this.options.page;
    switch (action.kind) {
      case 'click':
        if (!page) throw new Error('Click repair requires a Page.');
        if (action.ref) await page.ref(action.ref).click();
        else if (action.key) await page.getByKey(action.key).click();
        else if (action.text) await page.getByText(action.text).click();
        return;
      case 'wait':
        await new Promise((resolve) => setTimeout(resolve, action.ms));
        return;
      case 'dismissModal':
        if (!page) throw new Error('dismissModal repair requires a Page.');
        await page.dismissModal();
        return;
      case 'retryStep':
      case 'observe':
        return;
    }
  }
}

function redactProposal(action: RepairProposal): RepairProposal {
  if ('password' in action || 'token' in action || 'secret' in action) {
    return { kind: action.kind, redacted: true };
  }
  return action;
}
