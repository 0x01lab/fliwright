import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveFliwrightRuntimeRoot } from '@fliwright/core';
import { resolveProjectConfig, resolveProjectImport } from '@fliwright/cli';

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
  const presetOptions = { projectRoot: workspaceRoot, cacheRoot: project.cacheRoot, recording: project.recording, paths: project.paths,
    runsRoot: project.runsRoot, scenarios: project.scenarios, scenarioMode: project.scenarioMode };
  const stateDir = path.join(resolveFliwrightRuntimeRoot({ projectRoot: workspaceRoot }), 'tmp');
  await fs.mkdir(stateDir, { recursive: true });
  // Resolve the project dependency explicitly because the temporary config lives outside its node_modules tree.
  const presetUrl = resolveProjectImport('@fliwright/vitest/preset', workspaceRoot);
  const dir = await fs.mkdtemp(path.join(stateDir, 'script-config-'));
  const configPath = path.join(dir, 'vitest.config.mjs');
  const include = relativeScript.split(path.sep).join('/');
  await fs.writeFile(configPath, [
    `import { fliwrightPreset } from ${JSON.stringify(presetUrl)};`,
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
