import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveProjectConfig } from '@fliwright/cli';

export interface VitestScriptConfig {
  path: string;
  cleanup: () => Promise<void>;
}

/** Standard fixture scripts can import their project support module indirectly. */
export function usesVitestScript(filePath: string, source: string): boolean {
  return /\.script\.[cm]?[jt]s$/i.test(filePath)
    || /from\s+['"]@fliwright\/vitest['"]/.test(source)
    || /import\s*\(\s*['"]@fliwright\/vitest['"]\s*\)/.test(source);
}

export async function createVitestScriptConfig(relativeScript: string, workspaceRoot: string): Promise<VitestScriptConfig> {
  const project = await resolveProjectConfig(workspaceRoot);
  const presetOptions = { recording: project.recording, paths: project.paths,
    runsRoot: project.runsRoot, scenarios: project.scenarios, scenarioMode: project.scenarioMode };
  const stateDir = path.join(workspaceRoot, '.fliwright');
  await fs.mkdir(stateDir, { recursive: true });
  // Keep module resolution in the target project, including ESM-only exports.
  const dir = await fs.mkdtemp(path.join(stateDir, 'script-config-'));
  const configPath = path.join(dir, 'vitest.config.mjs');
  const include = relativeScript.split(path.sep).join('/');
  await fs.writeFile(configPath, [
    "import { fliwrightPreset } from '@fliwright/vitest/preset';",
    'export default {',
    `  root: ${JSON.stringify(workspaceRoot)},`,
    `  ...fliwrightPreset({ ...${JSON.stringify(presetOptions)}, test: {`,
    `    include: [${JSON.stringify(include)}],`,
    "    environment: 'node',",
    '    maxWorkers: 1,',
    '    isolate: false,',
    '    fileParallelism: false,',
    '    testTimeout: 60_000,',
    '    hookTimeout: 30_000,',
    '  } }),',
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
