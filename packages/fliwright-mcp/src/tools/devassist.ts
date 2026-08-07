import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DevAssistCoordinator, type DevAssistCoordinatorDeps, type DevAssistCycleResult } from '@fliwright/tdd';
import type { ServerState } from '../state.js';

const DevAssistCycleParamsObjectSchema = z.object({
  request: z.string().optional().describe('Natural-language behavior to verify; it takes precedence over change-only inference.'),
  devAssistSessionId: z.string().optional().describe('Stable DevAssist session id for continue or regenerate.'),
  action: z.enum(['start', 'continue', 'regenerate']).optional().describe('Defaults to start without a session id and continue with one.'),
  files: z.array(z.string()).optional().describe('Override the changed files included in the snapshot.'),
  baseRevision: z.string().optional().describe('Override the Git baseline revision used for the change snapshot.'),
  vmServiceUrl: z.string().optional().describe('Reserved VM service URL context; start the persistent TDD runtime before the cycle.'),
  deviceId: z.string().optional().describe('Reserved Flutter device context; start the persistent TDD runtime before the cycle.'),
  projectId: z.string().optional().describe('Reserved project context for the persistent TDD runtime.'),
  target: z.string().optional().describe('Reserved Flutter target context for the persistent TDD runtime.'),
});

export const DevAssistCycleParamsSchema = DevAssistCycleParamsObjectSchema.superRefine((input, context) => {
  if ((input.action === 'continue' || input.action === 'regenerate') && !input.devAssistSessionId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['devAssistSessionId'],
      message: `devAssistSessionId is required when action is '${input.action}'.`,
    });
  }
});

interface DevAssistCoordinatorLike {
  cycle(input: z.infer<typeof DevAssistCycleParamsSchema>): Promise<DevAssistCycleResult>;
}

type DevAssistCoordinatorFactory = (deps: DevAssistCoordinatorDeps) => DevAssistCoordinatorLike;

export async function handleDevAssistCycle(
  params: z.input<typeof DevAssistCycleParamsSchema>,
  state: ServerState,
  coordinatorFactory: DevAssistCoordinatorFactory = (deps) => new DevAssistCoordinator(deps),
): Promise<DevAssistCycleResult> {
  const input = DevAssistCycleParamsSchema.parse(params);
  return await coordinatorFactory({
    runtime: state.getTddRuntime() ?? undefined,
  }).cycle(input);
}

export function registerDevAssistTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_devassist_cycle',
    'Generate and rerun one temporary focused test through a persistent DevAssist session',
    DevAssistCycleParamsObjectSchema.shape,
    async (params) => ({
      content: [{ type: 'text', text: JSON.stringify(await handleDevAssistCycle(params, state), null, 2) }],
    }),
  );
}
