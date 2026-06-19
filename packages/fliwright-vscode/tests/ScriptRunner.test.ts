import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { ScriptRunner } from '../src/scripts/ScriptRunner.js';
import { createWorkspace, writeText } from './helpers/workspace.js';

describe('ScriptRunner', () => {
  it('runs a node script with VM Service environment variables and streamed output', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/scripts/env.mjs', [
      'console.log(process.env.FLIWRIGHT_VM_SERVICE_URL);',
      'console.error(process.env.FLIWRIGHT_VM_URL);',
    ].join('\n'));

    const output: string[] = [];
    const result = await new ScriptRunner().run({
      workspaceRoot: Uri.file(root),
      script: {
        kind: 'scriptFile',
        uri: Uri.file(`${root}/.fliwright/scripts/env.mjs`),
        label: 'env.mjs',
      },
      vmServiceUrl: 'ws://127.0.0.1:52746/example=/ws',
      onOutput: (chunk, stream) => output.push(`${stream}:${chunk.trim()}`),
    });

    expect(result.passed).toBe(true);
    expect(result.totalTests).toBe(1);
    expect(result.stdout).toContain('ws://127.0.0.1:52746/example=/ws');
    expect(result.stderr).toContain('ws://127.0.0.1:52746/example=/ws');
    expect(output).toContain('stdout:ws://127.0.0.1:52746/example=/ws');
    expect(output).toContain('stderr:ws://127.0.0.1:52746/example=/ws');
  });

  it('runs @fliwright/vitest scripts through the Vitest runner', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/scripts/auto.mjs', [
      "import { script } from '@fliwright/vitest';",
      "script('auto', async () => {});",
    ].join('\n'));
    await writeText(root, 'bin/pnpm', [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      "const configPath = process.argv[process.argv.indexOf('--config') + 1];",
      'console.log(JSON.stringify({',
      '  argv: process.argv.slice(2),',
      '  config: fs.readFileSync(configPath, "utf8"),',
      '  vmServiceUrl: process.env.FLIWRIGHT_VM_SERVICE_URL,',
      '  vmUrl: process.env.FLIWRIGHT_VM_URL,',
      '}));',
    ].join('\n'));
    await import('node:fs/promises').then((fs) => fs.chmod(`${root}/bin/pnpm`, 0o755));

    const originalPath = process.env.PATH;
    process.env.PATH = `${root}/bin${process.platform === 'win32' ? ';' : ':'}${originalPath ?? ''}`;
    try {
      const result = await new ScriptRunner().run({
        workspaceRoot: Uri.file(root),
        script: {
          kind: 'scriptFile',
          uri: Uri.file(`${root}/.fliwright/scripts/auto.mjs`),
          label: 'auto.mjs',
        },
        vmServiceUrl: 'ws://127.0.0.1:52746/example=/ws',
      });

      expect(result.passed).toBe(true);
      const payload = JSON.parse(result.stdout);
      expect(payload.argv).toEqual([
        'exec',
        'vitest',
        'run',
        '.fliwright/scripts/auto.mjs',
        '--config',
        expect.stringMatching(/vitest\.config\.mjs$/),
        '--pool',
        'forks',
        '--poolOptions.forks.singleFork',
        '--no-fileParallelism',
      ]);
      expect(payload.config).not.toContain("from 'vitest/config'");
      expect(payload.config).toContain(`root: ${JSON.stringify(root)}`);
      expect(payload.config).toContain('include: [".fliwright/scripts/auto.mjs"]');
      expect(payload.vmServiceUrl).toBe('ws://127.0.0.1:52746/example=/ws');
      expect(payload.vmUrl).toBe('ws://127.0.0.1:52746/example=/ws');
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
