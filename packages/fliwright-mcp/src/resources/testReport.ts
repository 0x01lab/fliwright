import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerState } from '../state.js';

export function handleReadTestReport(state: ServerState): string {
  const result = state.getLastRunResult();
  if (!result) {
    return JSON.stringify({ message: 'No test run yet' }, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

export function registerTestReportResource(server: McpServer, state: ServerState): void {
  server.resource(
    'test_report',
    'fliwright://test-report/latest',
    { description: 'Results from the most recent test run', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: handleReadTestReport(state),
      }],
    }),
  );
}
