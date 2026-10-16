#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFliwrightServer } from './server.js';

async function main() {
  const { server } = createFliwrightServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error in Fliwright MCP:', error);
  process.exit(1);
});
