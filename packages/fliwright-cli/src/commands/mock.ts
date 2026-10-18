import { ToolMockServer } from '@fliwright/core';
import { join } from 'node:path';

export interface MockStartOptions {
  cwd?: string;
  signal?: AbortSignal;
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
  try {
    options.signal?.throwIfAborted();
    const url = await server.start();
    await server.loadRules(options.mockDir ?? join(cwd, '.fliwright/mocks'));
    console.error(`Fliwright mock controller: ${url}`);
    await new Promise<void>((resolve) => {
      const done = () => { process.removeListener('SIGINT', done); process.removeListener('SIGTERM', done); options.signal?.removeEventListener('abort', done); resolve(); };
      process.once('SIGINT', done); process.once('SIGTERM', done);
      if (options.signal?.aborted) done(); else options.signal?.addEventListener('abort', done, { once: true });
    });
  } finally { await server.stop({ signal: options.signal }); }
}
