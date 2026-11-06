import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CloudClient, CloudError } from '@fliwright/cloud-protocol';
import { workerConfigSchema } from '../src/config.js';
import { retrySpool } from '../src/worker.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'retry-spool-'));
  roots.push(root);
  vi.stubEnv('RETRY_SPOOL_TOKEN', 'synthetic-spool-credential');
  const config = workerConfigSchema.parse({ serverUrl: 'https://cloud.test', tokenEnv: 'RETRY_SPOOL_TOKEN',
    workerId: 'mac', slotId: 'ios', deviceId: 'phone', root, resetCommands: [{ program: 'true', args: [] }] });
  const directory = join(root, 'spool', 'attempt');
  mkdirSync(join(directory, 'bundle'), { recursive: true });
  writeFileSync(join(directory, 'bundle', 'run.json'), JSON.stringify({ runId: 'run' }));
  writeFileSync(join(directory, 'job.json'), JSON.stringify({ lease: { workerId: 'mac', slotId: 'ios', attemptId: 'attempt', generation: 1 } }));
  writeFileSync(join(directory, 'publication.json'), JSON.stringify({ id: 'publication', token: 'upload-capability' }));
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ verdict: 'failed', bundleDir: join(directory, 'bundle') }));
  return { root, config, directory };
}

it('reclaims a successfully retried bundle and never uploads that publication again', async () => {
  const { config, directory } = setup();
  const request = vi.spyOn(CloudClient.prototype, 'request').mockResolvedValue({});
  await retrySpool(config);
  expect(request.mock.calls.map(([path]) => path)).toContain('/api/publications/publication/commit');
  expect(existsSync(join(directory, 'bundle'))).toBe(false);
  expect(existsSync(join(directory, 'publication.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8')).verdict).toBe('failed');
  request.mockClear();
  await retrySpool(config);
  expect(request).not.toHaveBeenCalled();
});

it('retains a failed retry within the budget and releases the maintenance lock', async () => {
  const { config, directory, root } = setup();
  vi.spyOn(CloudClient.prototype, 'request').mockRejectedValue(new CloudError(409, 'not available'));
  await retrySpool(config);
  expect(existsSync(join(directory, 'bundle', 'run.json'))).toBe(true);
  expect(existsSync(join(root, 'slot.lock'))).toBe(false);
});

it('refuses upload maintenance while an execution or recovery owns the slot', async () => {
  const { config, directory, root } = setup();
  writeFileSync(join(root, 'slot.lock'), '{}');
  const request = vi.spyOn(CloudClient.prototype, 'request');
  await expect(retrySpool(config)).rejects.toThrow(/lock|recovery/i);
  expect(request).not.toHaveBeenCalled();
  expect(existsSync(join(directory, 'bundle', 'run.json'))).toBe(true);
});
