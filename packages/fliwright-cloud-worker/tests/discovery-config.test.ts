import { expect, it } from 'vitest';
import { discoveryConfigSchema, workerConfigSchema } from '../src/config.js';
it('supports discovery-only hosts without execution slots, roots or reset commands', () => {
  const config = {
    serverUrl: 'https://cloud.test',
    tokenEnv: 'CLOUD_TOKEN',
    deviceTools: { adb: '/sdk/adb' },
  };
  expect(discoveryConfigSchema.parse(config)).toEqual(config);
  expect(workerConfigSchema.safeParse(config).success).toBe(false);
});

it('advertises the local executor device identity when claiming a server slot', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { vi } = await import('vitest');
  const { CloudClient } = await import('@fliwright/cloud-protocol');
  const { createWorker } = await import('../src/worker.js');
  const root = mkdtempSync(join(tmpdir(), 'claim-identity-'));
  vi.stubEnv('TEST_CLAIM_TOKEN', 'synthetic-claim-token');
  const request = vi
    .spyOn(CloudClient.prototype, 'request')
    .mockResolvedValue(null);
  try {
    const worker = createWorker(
      workerConfigSchema.parse({
        serverUrl: 'https://cloud.test',
        tokenEnv: 'TEST_CLAIM_TOKEN',
        workerId: 'host',
        slotId: 'phone',
        deviceId: 'native-device',
        root,
        resetCommands: [{ program: 'true', args: [] }],
      }),
    );
    expect(await worker.runOnce()).toBe(false);
    expect(request).toHaveBeenCalledWith('/api/worker/claim', {
      method: 'POST',
      body: { slotId: 'phone', deviceId: 'native-device' },
    });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
