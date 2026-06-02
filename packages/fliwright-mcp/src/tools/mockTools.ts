import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';

export const MockListParamsSchema = z.object({});

export const MockSwitchParamsSchema = z.object({
  mockDir: z.string().optional().describe('Path to .fliwright/mocks directory. Defaults to .fliwright/mocks.'),
  endpoint: z.string().describe('API endpoint path, e.g. "/v1/public/token"'),
  ruleName: z.string().describe('Name of the rule to activate, e.g. "success", "empty", "server_error"'),
});

export function registerMockListTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_list',
    'List all mock API endpoints, their available rules, and currently active rule',
    MockListParamsSchema.shape,
    async () => {
      const store = state.getRuleStore();
      const endpoints = store.listEndpoints();

      if (endpoints.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No mock rules loaded. Add endpoint configs under .fliwright/mocks/api/*.json, or use .fliwright/mocks/mock-index.json to select files and a default rule.',
          }],
        };
      }

      const lines = endpoints.map((ep) => {
        const rules = ep.rules.map((r) => r === ep.activeRule ? `${r} ✓` : r).join(', ');
        return `${ep.method} ${ep.endpoint} — [${rules}]`;
      });

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );
}

export function registerMockSwitchTool(server: McpServer, state: ServerState): void {
  server.tool(
    'fliwright_mock_switch',
    'Switch the active mock rule for a specific API endpoint. The endpoint must have been loaded from .fliwright/mocks/ config files.',
    MockSwitchParamsSchema.shape,
    async (params) => {
      const store = state.getRuleStore();

      if (!store.isLoaded) {
        const dir = params.mockDir ?? '.fliwright/mocks';
        await store.loadFromDirectory(dir);
      }

      try {
        store.switchRule(params.endpoint, params.ruleName);

        const endpoints = store.listEndpoints();
        const ep = endpoints.find((e) => e.endpoint === params.endpoint);
        const summary = ep
          ? `${ep.method} ${ep.endpoint} → ${ep.activeRule}`
          : `${params.endpoint} → ${params.ruleName}`;

        return {
          content: [{ type: 'text' as const, text: `Switched: ${summary}` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
