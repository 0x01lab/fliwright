import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { CliError, type CommandRegistry } from '../CommandRegistry.js';
import * as flow from '../commands/flow.js';
import * as runtime from '../commands/flow-runtime.js';
import * as schemas from './flow-schemas.js';
import type { AppSessionDeps } from '../capabilities/session.js';
import { connection } from './finite.js';
export function registerFlow(registry: CommandRegistry, deps: AppSessionDeps = {}): void {
  const commands = [
    ['list', schemas.FlowListParamsSchema, flow.flowListCommand],
    ['get', schemas.FlowGetParamsSchema, flow.flowGetCommand],
    ['bind-figma', schemas.FlowBindFigmaParamsSchema, flow.flowBindFigmaCommand],
    ['agent-spec', schemas.FlowAgentSpecParamsSchema, flow.flowAgentSpecCommand],
    ['clean', schemas.FlowCleanParamsSchema, flow.flowCleanCommand],
    ['review-plan', schemas.FlowReviewPlanParamsSchema, flow.flowReviewPlanCommand],
    ['review-bundle', schemas.FlowReviewBundleParamsSchema, flow.flowReviewBundleCommand],
    ['review-capture-figma', schemas.FlowReviewCaptureFigmaParamsSchema, flow.flowReviewCaptureFigmaCommand],
    ['review-report', schemas.FlowReviewReportParamsSchema, flow.flowReviewReportCommand],
    ['generate-test', schemas.FlowGenerateTestParamsSchema, flow.flowGenerateTestCommand],
    ['validate', schemas.FlowValidateParamsSchema, flow.flowValidateCommand],
    ['review-capture-runtime', schemas.FlowReviewCaptureRuntimeParamsSchema.extend(connection), runtime.flowReviewCaptureRuntimeCommand],
    ['review-run', schemas.FlowReviewRunParamsSchema.extend(connection), runtime.flowReviewRunCommand],
  ] as const;
  for (const [name, input, execute] of commands) registry.add({
    path: `flow.${name}`, description: `Flow ${name}`, input, positional: name === 'list' ? [] : ['id'],
    needsApp: name === 'review-run' || name === 'review-capture-runtime', effects: ['flow-artifacts'],
    async execute(input, context) {
      if (name === 'review-report') {
        for (const key of ['runtimeCaptures', 'figmaCaptures'] as const) {
          const fileKey = `${key}File`;
          const reportInput = input as Record<string, unknown>;
          if (reportInput[fileKey] !== undefined) {
            if (reportInput[key] !== undefined) throw new CliError('INVALID_INPUT', `Choose ${key} or ${fileKey}.`, 2);
            const body = await readFile(resolve(context.cwd, String(reportInput[fileKey])), 'utf8');
            let parsed: unknown;
            try { parsed = JSON.parse(body); } catch { throw new CliError('INVALID_INPUT', `${fileKey} must contain a JSON array.`, 2); }
            reportInput[key] = z.array(schemas.FlowReviewArtifactSchema).parse(parsed);
          }
        }
      }
      const data = await (execute as (options: any, deps: AppSessionDeps) => Promise<any>)({ ...input, cwd: context.cwd, signal: context.signal }, deps);
      if (data.validation?.errorCount > 0 || data.report?.summary.failed > 0 || data.report?.summary.missing > 0 || data.captures?.some((capture: { status: string }) => capture.status === 'failed')) {
        throw new CliError('VALIDATION_FAILED', 'Flow validation or review failed.', 1, data);
      }
      return data;
    },
  });
}
