import { expect, it } from 'vitest';
import { executeProcess } from '../src/process.js';
import { executeCli } from '../src/cli.js';

it('executes arguments literally and sends requirement text over stdin', async () => {
  const result = await executeProcess(process.execPath, ['-e', 'process.stdin.on("data", data => process.stdout.write(process.argv[1] + ":" + data))', '$(false);`false`'], { input: 'case data' });
  expect(result).toBe('$(false);`false`:case data');
});
it('reaps a cancelled generation process', async () => {
  const controller = new AbortController();
  const task = executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  controller.abort(new Error('test cancellation'));
  await expect(task).rejects.toThrow('test cancellation');
});
it('bounds stalled processes and handles unavailable executables', async () => {
  await expect(executeProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 30 })).rejects.toThrow(/timed out/);
  await expect(executeProcess('nonexistent-test-plan-executable', [], {})).rejects.toThrow(/Cannot start/);
});
it('exposes an independent fetch/bind CLI and validates required flags', async () => {
  const result = await executeCli(['--help']);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('fetch');
  expect(result.stdout).toContain('bind');
  expect((await executeCli(['fetch', 'https://gitlab.example.com/a/b/-/issues/1'])).exitCode).toBe(2);
  expect((await executeCli(['bind', 'plan.json', 'ID', '--file', 'a.test.ts', '--output', 'bound.json'])).exitCode).toBe(2);
});

it('preserves Chinese GitLab text when UTF-8 code points span process output chunks', async () => {
  const result = await executeProcess(process.execPath, ['-e', 'const data = Buffer.from("中文用例"); process.stdout.write(data.subarray(0, 1)); setTimeout(() => process.stdout.write(data.subarray(1)), 30)'], {});
  expect(result).toBe('中文用例');
});
