import { afterEach, expect, it, vi } from 'vitest';
import { executeCli } from '../src/index.js';
import { sessionRequest } from '../src/session/client.js';
vi.mock('../src/session/client.js', () => ({
  sessionRequest: vi.fn(), sessionOpenCommand: vi.fn(), sessionListCommand: vi.fn(),
}));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });

it.each([
  ['cycle', ['--sync', 'reload'], { sync: 'reload' }],
  ['sync', ['--mode', 'reload'], { mode: 'reload' }],
  ['status', [], {}],
] as const)('routes dual-mode tdd %s to the selected connection host', async (command, flags, input) => {
  vi.mocked(sessionRequest).mockResolvedValue({ host: true });
  const result = await executeCli(['tdd', command, ...flags, '--session', 'selected-host', '--json']);
  expect(result.exitCode).toBe(0);
  expect(sessionRequest).toHaveBeenCalledWith(expect.any(String), 'selected-host', expect.objectContaining({
    type: 'execute', command: `tdd.${command}`, input, operationId: expect.any(String),
  }), expect.any(AbortSignal));
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, operationId: expect.any(String), data: { host: true } });
});

it('also honors inherited sessions for dual-mode TDD and rejects endpoint replacement', async () => {
  vi.stubEnv('FLIWRIGHT_SESSION', 'selected-host');
  const result = await executeCli(['tdd', 'sync', '--mode', 'reload', '--vm-url', 'ws://other/ws', '--json']);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: 'INVALID_INPUT', message: '--session cannot change its endpoint or device.' } });
  expect(sessionRequest).not.toHaveBeenCalled();
});

it('keeps finite cycle input requirements when no session is selected', async () => {
  vi.stubEnv('FLIWRIGHT_SESSION', '');
  const result = await executeCli(['tdd', 'cycle', '--json']);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout)).toMatchObject({ error: { code: 'INVALID_INPUT', message: expect.stringContaining('Finite cycle requires --file') } });
  expect(sessionRequest).not.toHaveBeenCalled();
});
