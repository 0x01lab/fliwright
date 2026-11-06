import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const mocks = vi.hoisted(() => ({ inventory: vi.fn(), scanner: vi.fn() }));
vi.mock('../src/device-reporting.js', () => ({ reportWorkerDevices: mocks.inventory }));
vi.mock('../src/catalog-scanner.js', () => ({ runCatalogScanner: mocks.scanner }));
vi.mock('@fliwright/cloud-protocol', async original => ({ ...await original<object>(), WorkerControlClient: class {
  connected = true; revision = 0;
  async ready() {} close() {} onConnected() { return () => {}; }
  async request() { return { workerId: 'mac', devices: [] }; }
  waitForWork(_revision: number, signal: AbortSignal) { return new Promise<void>((resolve) => { signal.addEventListener('abort', () => resolve(), { once: true }); if (signal.aborted) resolve(); }); }
} }));
import { runHostWorker } from '../src/host.js';
import { hostConfigSchema } from '../src/config.js';
import { WorkerDiagnostics, readWorkerLogs } from '../src/diagnostics.js';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('surfaces a background service rejection immediately and terminates sibling loops without an unhandled rejection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'host-diagnostic-'));
  vi.stubEnv('TEST_HOST_DIAGNOSTIC_TOKEN', 'private-host-diagnostic-token');
  mocks.inventory.mockRejectedValue(new Error('Inventory watcher failed'));
  mocks.scanner.mockImplementation((_client, { signal }) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })));
  try {
    const log = new WorkerDiagnostics(root);
    const config = hostConfigSchema.parse({ root, serverUrl: 'http://localhost:1', tokenEnv: 'TEST_HOST_DIAGNOSTIC_TOKEN' });
    await expect(runHostWorker(config, join(root, 'worker.json'), new AbortController().signal, log)).rejects.toThrow('Inventory watcher failed');
    expect(log.snapshot()).toMatchObject({ state: 'degraded', components: { inventory: 'failed' } });
    expect(readWorkerLogs(root).some(entry => entry.event === 'component.failed' && entry.stack?.includes('Inventory watcher failed'))).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
