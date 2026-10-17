import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FliwrightDriver } from '@fliwright/core';
import { doctorCommand } from '../src/commands/doctor.js';
import { resolveVmUrl } from '../src/vm-discovery.js';

vi.mock('../src/vm-discovery.js', () => ({ resolveVmUrl: vi.fn(async () => null), discoverVmServiceUrl: vi.fn(async () => null) }));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fliwright-doctor-recording-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await writeFile(join(root, 'fliwright.config.ts'), `export default {
    vmServiceUrl: 'ws://project/ws', paths: { tests: 'qa/checks', recordings: 'qa/captures' },
    scenarios: { saved: { name: 'saved', layers: [] } }
  };`);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.mocked(resolveVmUrl).mockReset();
  await rm(root, { recursive: true, force: true });
});

it('reports effective settings and the actually resolved Vitest preset without executing tests', async () => {
  vi.stubEnv('FLIWRIGHT_RECORDING_MODE', 'full');
  await writeFile(join(root, 'vitest.config.mjs'), `
    import { fliwrightPreset } from ${JSON.stringify(import.meta.resolve('@fliwright/vitest/preset'))};
    import project from './fliwright.config.ts';
    export default fliwrightPreset(project);
  `);
  const checks = await doctorCommand(root);
  expect(checks.find((item) => item.name === 'Recording configuration')).toMatchObject({ passed: true,
    message: expect.stringMatching(/mode=full.*scenarios=saved.*environment/) });
  expect(checks.find((item) => item.name === 'Automation paths')?.message).toContain('tests=qa/checks');
  expect(checks.find((item) => item.name === 'Automation paths')?.message).toContain('recordings=qa/captures');
  expect(checks.find((item) => item.name === 'Vitest recording preset')).toMatchObject({ passed: true,
    message: expect.stringContaining('qa/checks/**/*.test.ts') });
  expect(resolveVmUrl).toHaveBeenCalledWith(expect.objectContaining({ cwd: root, configUrl: 'ws://project/ws', verify: true }));
});

it('does not mistake a preset name in a comment for an active runner', async () => {
  await writeFile(join(root, 'vitest.config.mjs'), `// fliwrightPreset()
    export default { test: { include: ['qa/**/*.test.ts'] } };`);
  const checks = await doctorCommand(root);
  expect(checks.find((item) => item.name === 'Vitest recording preset')).toMatchObject({ passed: false,
    message: expect.stringMatching(/fliwrightPreset/) });
});

it('shows individual recording and evidence capabilities and releases the diagnostic driver', async () => {
  vi.mocked(resolveVmUrl).mockResolvedValue('ws://diagnostic/ws');
  vi.spyOn(FliwrightDriver.prototype, 'connect').mockResolvedValue(undefined);
  const dispose = vi.spyOn(FliwrightDriver.prototype, 'dispose').mockResolvedValue(undefined);
  vi.spyOn(FliwrightDriver.prototype, 'sendRequest').mockImplementation(async (method) => {
    if (method === 'ext.fliwright.ping') return { status: 'ok' };
    if (method === 'ext.fliwright.handshake') return { compatible: true, protocolVersion: 2, bridgeCapabilities: {
      recordingBeforeDispatchTarget: false, recordingFocusedInputController: true,
    } };
    if (method === 'ext.fliwright.screenshot') throw new Error('no render surface');
    if (method === 'ext.fliwright.snap') return { snapshot: 'visible UI', refs: [] };
    return {};
  });
  const checks = await doctorCommand(root);
  expect(checks.find((item) => item.name === 'Recording target capture')).toMatchObject({ passed: false,
    message: expect.stringContaining('FliwrightRecordingBinding') });
  expect(checks.find((item) => item.name === 'Recording focused input')?.passed).toBe(true);
  expect(checks.find((item) => item.name === 'Evidence screenshot')).toMatchObject({ passed: false,
    message: expect.stringContaining('no render surface') });
  expect(checks.find((item) => item.name === 'Evidence snapshot')?.passed).toBe(true);
  expect(dispose).toHaveBeenCalledOnce();
});

it('disposes the driver even if the VM connection fails', async () => {
  vi.mocked(resolveVmUrl).mockResolvedValue('ws://diagnostic/ws');
  vi.spyOn(FliwrightDriver.prototype, 'connect').mockRejectedValue(new Error('connection failed'));
  const dispose = vi.spyOn(FliwrightDriver.prototype, 'dispose').mockResolvedValue(undefined);
  await doctorCommand(root);
  expect(dispose).toHaveBeenCalledOnce();
});
