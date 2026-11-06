import { describe, expect, it } from 'vitest';
import { executeTool, quoteAndroidShell } from '../src/ToolExecutor.js';

function context(timeout = 1000) {
  return { requestId: 'tool-test', deadline: Date.now() + timeout, signal: new AbortController().signal };
}
describe('native tool execution', () => {
  it('preserves shell metacharacters as a single remote argument', async () => {
    const value = "spaces ' quotes \" double $HOME $(false) `false` ; & | < > \\ newline\n你好";
    const result = await executeTool('/bin/sh', ['-c', `printf %s ${quoteAndroidShell(value)}`], context());
    expect(result.toString()).toBe(value);
    expect(() => quoteAndroidShell('bad\0argument')).toThrow();
  });
  it('times out and kills a real child and does not expose command/input values in its error', async () => {
    await expect(executeTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)', 'private-value'], context(100)))
      .rejects.toMatchObject({ code: 'timeout' });
    const error = await executeTool(process.execPath, ['-e', 'process.stderr.write("private-value"); process.exit(1)'], context()).catch(error => error);
    expect(error.code).toBe('transport_lost');
    expect(JSON.stringify(error)).not.toContain('private-value');
    expect(error.message).not.toContain('private-value');
  });
  it('cancels an already running child without waiting for its natural exit', async () => {
    const controller = new AbortController();
    const request = executeTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...context(), signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await rejected;
  });
});
