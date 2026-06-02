import { ToolMockServer } from '@fliwright/core';
import { join } from 'node:path';

export interface MockStartOptions {
  cwd?: string;
  host?: string;
  port?: number;
  mockDir?: string;
}

export async function mockStartCommand(options: MockStartOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const server = new ToolMockServer({
    host: options.host,
    port: options.port,
  });
  const url = await server.start();
  await server.loadRules(options.mockDir ?? join(cwd, '.fliwright/mocks'));

  console.log(`Fliwright mock controller: ${url}`);
  console.log(`Flutter dart-define: --dart-define=FLIWRIGHT_MOCK_CONTROLLER_URL=${url}`);

  await waitForever();
}

function waitForever(): Promise<void> {
  return new Promise((resolve) => {
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
}
