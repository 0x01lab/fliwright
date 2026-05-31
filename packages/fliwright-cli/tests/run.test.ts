import { describe, it, expect } from 'vitest';
import { runCommand, type RunOptions } from '../src/commands/run.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('runCommand', () => {
  it('throws with friendly message when VM URL cannot be resolved', async () => {
    const options: RunOptions = {
      testPattern: 'tests/example.test.ts',
      reporter: 'pretty',
    };

    await expect(runCommand(options, {
      resolveVmUrl: async () => null,
    })).rejects.toThrow('Could not find a running Flutter VM Service');
  });

  it('passes vmServiceUrl through deps and runs vitest', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-run-'));
    await writeFile(join(tmpDir, 'pass.test.ts'), [
      "import { describe, expect, it } from 'vitest';",
      "describe('cli fixture', () => {",
      "  it('passes', () => { expect(1).toBe(1); });",
      "});",
    ].join('\n'));

    let capturedUrl: string | undefined;
    const result = await runCommand({
      testPattern: 'pass.test.ts',
      reporter: 'json',
      cwd: tmpDir,
    }, {
      resolveVmUrl: async () => 'ws://mock-vm:8181/ws',
      onVmResolved: (url) => { capturedUrl = url; },
    });

    expect(capturedUrl).toBe('ws://mock-vm:8181/ws');
    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(1);

    await rm(tmpDir, { recursive: true, force: true });
  });
});
