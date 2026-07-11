import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

export interface VitestScriptConfig {
  path: string;
  cleanup: () => Promise<void>;
}

export async function createVitestScriptConfig(relativeScript: string, workspaceRoot: string): Promise<VitestScriptConfig> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'fliwright-vscode-script-'));
  const configPath = path.join(dir, 'vitest.config.mjs');
  const include = relativeScript.split(path.sep).join('/');
  await fs.writeFile(configPath, [
    'export default {',
    `  root: ${JSON.stringify(workspaceRoot)},`,
    '  test: {',
    `    include: [${JSON.stringify(include)}],`,
    "    environment: 'node',",
    '    maxWorkers: 1,',
    '    isolate: false,',
    '    fileParallelism: false,',
    '    testTimeout: 60_000,',
    '    hookTimeout: 30_000,',
    '  },',
    '};',
    '',
  ].join('\n'));
  return {
    path: configPath,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
