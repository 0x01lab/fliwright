import { expect, it } from 'vitest';
import { runTool } from '../src/commands.js';

it('passes executable arguments literally without a shell', async () => {
  const value = '$(echo should-not-run); `echo literal`';
  const result = await runTool(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value], { timeoutMs: 1000 });
  expect(result).toBe(value);
});
it('terminates timed out or cancelled native commands', async () => {
  await expect(runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 40 })).rejects.toMatchObject({ killed: true });
  const controller = new AbortController();
  const running = runTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5000, signal: controller.signal });
  controller.abort();
  await expect(running).rejects.toMatchObject({ name: 'AbortError' });
});
