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
});
