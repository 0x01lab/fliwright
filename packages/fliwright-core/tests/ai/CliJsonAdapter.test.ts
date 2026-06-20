import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { AiParseError, AiTimeoutError, CliJsonAdapter } from '../../src/index.js';

async function fakeCli(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fliwright-ai-cli-'));
  const path = join(dir, 'fake-cli.mjs');
  await writeFile(path, source, { mode: 0o755 });
  return path;
}

describe('CliJsonAdapter', () => {
  it('passes normalized request JSON over stdin and parses stdout JSON', async () => {
    const command = await fakeCli(`
      let input = '';
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        const request = JSON.parse(input);
        process.stdout.write(JSON.stringify({ text: JSON.stringify({ prompt: request.prompt }), json: { prompt: request.prompt } }));
      });
    `);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    const response = await adapter.invoke(
      { prompt: 'hello', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    );

    expect(response.json).toEqual({ prompt: 'hello' });
  });

  it('writes request JSON to a file in request-file mode', async () => {
    const output = join(await mkdtemp(join(tmpdir(), 'fliwright-ai-cli-output-')), 'request-path.txt');
    const command = await fakeCli(`
      import { readFileSync, writeFileSync } from 'node:fs';
      const requestPath = process.argv.at(-1);
      writeFileSync(${JSON.stringify(output)}, requestPath);
      const request = JSON.parse(readFileSync(requestPath, 'utf8'));
      process.stdout.write(JSON.stringify({ text: request.prompt, json: { prompt: request.prompt } }));
    `);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'request-file' });

    const response = await adapter.invoke(
      { prompt: 'from-file', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    );

    const requestPath = await readFile(output, 'utf8');
    expect(requestPath).toContain('request.json');
    expect(response.json).toEqual({ prompt: 'from-file' });
  });

  it('parses a fenced JSON block when stdout has surrounding text', async () => {
    const command = await fakeCli(`
      process.stdin.resume();
      process.stdin.on('end', () => {
        process.stdout.write('Result:\\n\\\`\\\`\\\`json\\n{"text":"ok","json":{"ok":true}}\\n\\\`\\\`\\\`\\n');
      });
    `);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'ok', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).resolves.toMatchObject({ json: { ok: true } });
  });

  it('parses JSONL assistant events from CLI streaming output', async () => {
    const command = await fakeCli(`
      process.stdin.resume();
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({ type: 'session.created', id: 's1' }) + '\\n');
        process.stdout.write(JSON.stringify({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '{"ok":true}' }]
        }) + '\\n');
      });
    `);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'ok', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).resolves.toMatchObject({ json: { ok: true } });
  });

  it('throws AiParseError for non-json output when json is required', async () => {
    const command = await fakeCli(`process.stdout.write('not json');`);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'bad', responseFormat: 'json' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).rejects.toBeInstanceOf(AiParseError);
  });

  it('throws with stderr when the process exits non-zero', async () => {
    const command = await fakeCli(`process.stderr.write('boom'); process.exit(2);`);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'fail' },
      { callId: 'call-1', timeoutMs: 1000, signal: new AbortController().signal, runtime: {} },
    )).rejects.toThrow('boom');
  });

  it('kills the process and throws AiTimeoutError on timeout', async () => {
    const command = await fakeCli(`setTimeout(() => process.stdout.write('late'), 2000);`);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });

    await expect(adapter.invoke(
      { prompt: 'slow' },
      { callId: 'call-1', timeoutMs: 10, signal: new AbortController().signal, runtime: {} },
    )).rejects.toBeInstanceOf(AiTimeoutError);
  });

  it('kills the process when the invocation signal aborts', async () => {
    const command = await fakeCli(`setTimeout(() => process.stdout.write('late'), 2000);`);
    const adapter = new CliJsonAdapter({ command: process.execPath, args: [command], inputMode: 'stdin-json' });
    const controller = new AbortController();

    const result = adapter.invoke(
      { prompt: 'abort' },
      { callId: 'call-1', timeoutMs: 1000, signal: controller.signal, runtime: {} },
    );
    controller.abort();

    await expect(result).rejects.toThrow('AI CLI invocation aborted');
  });
});
