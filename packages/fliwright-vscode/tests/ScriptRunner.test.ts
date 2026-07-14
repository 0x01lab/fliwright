import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { ScriptRunner } from '../src/scripts/ScriptRunner.js';
import { terminalScriptCommand } from '../src/extension.js';
import { createWorkspace, readText, writeText } from './helpers/workspace.js';

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

  it('waits for script completion before resolving so follow-up state sync can read final app state', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/scripts/sync.mjs', [
      "import { writeFile } from 'node:fs/promises';",
      "await new Promise((resolve) => setTimeout(resolve, 50));",
      "await writeFile('.fliwright/script-state.txt', 'mock-state-ready');",
    ].join('\n'));

    const result = await new ScriptRunner().run({
      workspaceRoot: Uri.file(root),
      script: {
        kind: 'scriptFile',
        uri: Uri.file(`${root}/.fliwright/scripts/sync.mjs`),
        label: 'sync.mjs',
      },
    });

    expect(result.passed).toBe(true);
    await expect(readText(root, '.fliwright/script-state.txt')).resolves.toBe('mock-state-ready');
  });

  it('passes E2E automation environment variables to node scripts when enabled', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/scripts/e2e.mjs', [
      'console.log(JSON.stringify({',
      '  fliwright: process.env.FLIWRIGHT_E2E_AUTOMATION,',
      '  exio: process.env.EXIO_AUTOMATION,',
      '  aliyun: process.env.EXIO_DISABLE_ALIYUN_CAPTCHA,',
      '}));',
    ].join('\n'));

    const result = await new ScriptRunner().run({
      workspaceRoot: Uri.file(root),
      script: {
        kind: 'scriptFile',
        uri: Uri.file(`${root}/.fliwright/scripts/e2e.mjs`),
        label: 'e2e.mjs',
      },
      e2eAutomationEnabled: true,
    });

    expect(result.passed).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual({
      fliwright: 'true',
      exio: 'true',
      aliyun: 'true',
    });
  });

  it('runs @fliwright/vitest scripts through the Vitest runner', async () => {
    const root = await createWorkspace();
    await writeText(root, 'package.json', JSON.stringify({ type: 'module' }));
    await writeText(root, '.fliwright/scripts/auto.mjs', [
      "import { script } from '@fliwright/vitest';",
      "script('auto', async () => {});",
    ].join('\n'));
    await writeText(root, 'node_modules/vitest/package.json', JSON.stringify({
      name: 'vitest',
      type: 'module',
      main: './vitest.mjs',
    }));
    await writeText(root, 'node_modules/vitest/vitest.mjs', [
      "import fs from 'node:fs';",
      "const configPath = process.argv[process.argv.indexOf('--config') + 1];",
      'console.log(JSON.stringify({',
      '  cli: process.argv[1],',
      '  argv: process.argv.slice(2),',
      '  config: fs.readFileSync(configPath, "utf8"),',
      '  vmServiceUrl: process.env.FLIWRIGHT_VM_SERVICE_URL,',
      '  vmUrl: process.env.FLIWRIGHT_VM_URL,',
      '  fliwrightE2eAutomation: process.env.FLIWRIGHT_E2E_AUTOMATION,',
      '}));',
    ].join('\n'));

    const result = await new ScriptRunner().run({
      workspaceRoot: Uri.file(root),
      script: {
        kind: 'scriptFile',
        uri: Uri.file(`${root}/.fliwright/scripts/auto.mjs`),
        label: 'auto.mjs',
      },
      vmServiceUrl: 'ws://127.0.0.1:52746/example=/ws',
      e2eAutomationEnabled: true,
    });

    expect(result.passed).toBe(true);
    const payload = JSON.parse(result.stdout);
    expect(payload.cli).toMatch(/node_modules[\\/]vitest[\\/]vitest\.mjs$/);
    expect(payload.argv).toEqual([
      'run',
      '.fliwright/scripts/auto.mjs',
      '--config',
      expect.stringMatching(/vitest\.config\.mjs$/),
    ]);
    expect(payload.config).not.toContain("from 'vitest/config'");
    expect(payload.config).toContain(`root: ${JSON.stringify(root)}`);
    expect(payload.config).toContain('include: [".fliwright/scripts/auto.mjs"]');
    expect(payload.config).toContain('maxWorkers: 1');
    expect(payload.config).toContain('isolate: false');
    expect(payload.config).toContain('fileParallelism: false');
    expect(payload.vmServiceUrl).toBe('ws://127.0.0.1:52746/example=/ws');
    expect(payload.vmUrl).toBe('ws://127.0.0.1:52746/example=/ws');
    expect(payload.fliwrightE2eAutomation).toBe('true');
  });

  it('builds the VS Code terminal command without pnpm exec for @fliwright/vitest scripts', async () => {
    const root = await createWorkspace();
    await writeText(root, 'package.json', JSON.stringify({ type: 'module' }));
    await writeText(root, '.fliwright/scripts/auto.mjs', [
      "import { script } from '@fliwright/vitest';",
      "script('auto', async () => {});",
    ].join('\n'));
    await writeText(root, 'node_modules/vitest/package.json', JSON.stringify({
      name: 'vitest',
      type: 'module',
      main: './vitest.mjs',
    }));
    await writeText(root, 'node_modules/vitest/vitest.mjs', '');

    const command = await terminalScriptCommand(Uri.file(root), {
      kind: 'scriptFile',
      uri: Uri.file(`${root}/.fliwright/scripts/auto.mjs`),
      label: 'auto.mjs',
    });

    expect(command).not.toContain('pnpm');
    expect(command).not.toContain('exec vitest');
    expect(command).not.toContain('poolOptions');
    expect(command).not.toContain('fileParallelism');
    expect(command.replace(/\\/g, '/')).toContain('/node_modules/vitest/vitest.mjs run .fliwright/scripts/auto.mjs');
    expect(command).toContain('--config');
  });
});
