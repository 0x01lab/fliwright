import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { CliError } from '../CommandRegistry.js';
import { prepareAgentSetup, type AgentSetupResult } from '../InitAgent.js';

const NODE_DEV_DEPENDENCIES: Record<string, string> = {
  '@fliwright/cli': '^0.1.0',
  '@fliwright/vitest': '^0.1.0',
  '@types/node': '^22.0.0',
  typescript: '^5.5.0',
  vitest: '5.0.5',
};

const DEFAULT_SCRIPTS: Record<string, string> = {
  'test:fliwright': 'fliwright run',
  'doctor:fliwright': 'fliwright doctor',
  'record:fliwright': 'fliwright record',
};

const CONFIG_TEMPLATE = `import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  // Runtime data defaults to ~/.fliwright/<absolute-project-path-with-dashes>/.
  // runsRoot: 'artifacts/runs',
  // cacheRoot: 'artifacts/cache',
  // vmServiceUrl: 'ws://127.0.0.1:8181/ws',
  timeout: 30000,
  screenshot: 'file',
  recording: { mode: 'standard' },
  paths: {
    tests: '.fliwright/tests', scripts: '.fliwright/scripts',
    flows: '.fliwright/flows',
  },
  reporter: 'pretty',
});
`;

const VITEST_CONFIG_TEMPLATE = `import { defineConfig } from 'vitest/config';
import { fliwrightPreset } from '@fliwright/vitest/preset';
import projectConfig from './fliwright.config.js';

export default defineConfig({
  ...fliwrightPreset(projectConfig),
});
`;

const EXAMPLE_TEST_TEMPLATE = `import { test, expect } from '@fliwright/vitest';

test('counter increments', async ({ page }) => {
  // Replace with your app's actual widgets.
  await expect(page.locator('text=Counter')).toBeVisible();

  await page.locator('text=Increment').click();

  await expect(page.locator('text=Count: 1')).toBeVisible();
});
`;

const EXAMPLE_SCRIPT_TEMPLATE = `import { script, expect } from '@fliwright/vitest';

script('counter smoke script', async ({ page }) => {
  await expect(page.locator('text=Counter')).toBeVisible();
  await page.locator('text=Increment').click();
});
`;

const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node", "vitest"]
  },
  "include": ["fliwright.config.ts", "vitest.config.ts", ".fliwright/tests/**/*.ts", ".fliwright/scripts/**/*.ts"]
}
`;

const GITIGNORE_LINES = [
  '.fliwright/runs/',
  '.fliwright/cache/',
  '.fliwright/ai/',
  '.fliwright/failures/',
  '.fliwright/memory/',
];

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface InitOptions {
  install?: boolean;
  node?: boolean;
  flutter?: boolean;
  packageManager?: PackageManager;
  agent?: 'codex';
  yes?: boolean;
  entrypoint?: string;
}

export interface InitResult {
  created: string[];
  updated: string[];
  skipped: string[];
  commands: Array<{ command: string; args: string[]; cwd: string }>;
  status: 'configured' | 'needs-attention';
  runtimeVerified: false;
  checks: Array<{ name: string; status: 'passed' | 'pending'; message: string }>;
  nextSteps: string[];
  agent?: AgentSetupResult;
}

export interface InitDeps {
  log?: (message: string) => void;
  runCommand?: (command: string, args: string[], cwd: string) => Promise<void>;
  skillsRoot?: string;
  signal?: AbortSignal;
}

interface PackageJson {
  name?: string;
  private?: boolean;
  type?: string;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export async function initCommand(
  projectDir: string,
  options: InitOptions = {},
  deps: InitDeps = {},
): Promise<InitResult> {
  const log = deps.log ?? console.log;
  const result: InitResult = { created: [], updated: [], skipped: [], commands: [], status: 'needs-attention', runtimeVerified: false, checks: [], nextSteps: [] };
  const install = options.install ?? true;
  const setupNode = options.node ?? true;
  const setupFlutter = options.flutter ?? true;
  deps.signal?.throwIfAborted();
  const hasFlutterProject = await fileExists(join(projectDir, 'pubspec.yaml'));
  const entrypoint = options.entrypoint ?? 'lib/main.dart';
  if (options.agent && (!hasFlutterProject || !setupFlutter || !setupNode)) {
    throw new CliError('INVALID_INPUT', '--agent codex requires a Flutter project (pubspec.yaml) and Node/Flutter setup enabled.', 2);
  }
  if (options.agent || options.entrypoint) {
    const entryRelative = relative(resolve(projectDir, 'lib'), resolve(projectDir, entrypoint));
    if (isAbsolute(entrypoint) || entryRelative.startsWith('..') || !/^[A-Za-z0-9_./-]+\.dart$/.test(entrypoint) || !await fileExists(join(projectDir, entrypoint))) {
      throw new CliError('INVALID_INPUT', 'App entrypoint must be an existing Dart file inside lib/. Specify --entrypoint lib/main_flavor.dart.', 2);
    }
  }
  const installAgent = options.agent ? await prepareAgentSetup(projectDir, deps.skillsRoot) : undefined;
  let vitestConfigPath = join(projectDir, 'vitest.config.ts');
  for (const extension of ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs']) {
    const candidate = join(projectDir, `vitest.config.${extension}`);
    if (await fileExists(candidate)) { vitestConfigPath = candidate; break; }
  }

  await writeIfAbsent(join(projectDir, 'fliwright.config.ts'), CONFIG_TEMPLATE, result, log);
  await writeIfAbsent(vitestConfigPath, VITEST_CONFIG_TEMPLATE, result, log);
  await mkdir(join(projectDir, '.fliwright', 'tests'), { recursive: true });
  await writeIfAbsent(join(projectDir, '.fliwright', 'tests', 'example.test.ts'), EXAMPLE_TEST_TEMPLATE, result, log);
  await mkdir(join(projectDir, '.fliwright', 'scripts'), { recursive: true });
  await writeIfAbsent(join(projectDir, '.fliwright', 'scripts', 'example.script.ts'), EXAMPLE_SCRIPT_TEMPLATE, result, log);
  await writeIfAbsent(join(projectDir, 'tsconfig.json'), TSCONFIG_TEMPLATE, result, log);
  await ensureGitignore(projectDir, result, log);

  if (setupNode) {
    await ensurePackageJson(projectDir, result, log);
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8')) as PackageJson;
    const matched = pkg.type === 'module' && pkg.devDependencies?.vitest === NODE_DEV_DEPENDENCIES.vitest;
    result.checks.push({ name: 'node-config', status: matched ? 'passed' : 'pending', message: matched
      ? 'Node ESM and the required Vitest version are declared.'
      : `Review existing package.json: generated TypeScript configuration requires type=module and Vitest ${NODE_DEV_DEPENDENCIES.vitest}. Existing values were preserved.` });
  }

  if (setupFlutter && hasFlutterProject) {
    await ensureFlutterEntry(projectDir, result, log, entrypoint);
  } else if (setupFlutter) {
    result.skipped.push('Flutter setup');
    log('No pubspec.yaml found - skipping Flutter bridge setup.');
  }
  if (installAgent) {
    result.agent = await installAgent(result);
    result.checks.push({ name: 'agent', status: result.agent.conflicts.length ? 'pending' : 'passed', message: result.agent.conflicts.length
      ? `Preserved customized Skills. Review: ${result.agent.conflicts.join(', ')}` : 'Project-local Codex Skills and AGENTS.md instructions installed.' });
  }

  if (install) {
    try {
      if (setupNode) {
        const packageManager = options.packageManager ?? await detectPackageManager(projectDir);
        await runAndTrack(packageManager, ['install'], projectDir, result, deps);
      }
      if (setupFlutter && hasFlutterProject) {
        await runAndTrack('flutter', ['pub', 'add', 'fliwright_bridge'], projectDir, result, deps);
      }
      result.checks.push({ name: 'dependencies', status: 'passed', message: 'Requested dependency installation commands completed.' });
    } catch (error) {
      deps.signal?.throwIfAborted();
      result.checks.push({ name: 'dependencies', status: 'pending', message: error instanceof Error ? error.message : String(error) });
      result.nextSteps.push('Resolve the dependency installation failure and rerun the same init command. Existing project files are preserved.');
      throw new CliError('INIT_INSTALL_FAILED', 'Dependency installation failed. Inspect data.checks and rerun init after fixing package registry or tool availability.', 3, result);
    }
  } else {
    result.skipped.push('Dependency install');
    result.checks.push({ name: 'dependencies', status: 'pending', message: 'Installation skipped. Install Node dependencies and configure fliwright_bridge before live use.' });
    log('Dependency installation skipped.');
  }

  const vitestConfig = await readFile(vitestConfigPath, 'utf8');
  const presetFound = vitestConfig.includes('fliwrightPreset(') && vitestConfig.includes('@fliwright/vitest/preset');
  result.checks.push({ name: 'vitest', status: presetFound ? 'passed' : 'pending', message: presetFound ? 'Fliwright preset reference found; use doctor for resolved configuration verification.' : `Merge fliwrightPreset(projectConfig) from @fliwright/vitest/preset into the existing ${basename(vitestConfigPath)}.` });
  if (setupFlutter && hasFlutterProject) {
    const entry = await readFile(join(projectDir, 'test_driver/fliwright_app.dart'), 'utf8');
    const importPath = entrypoint.replace(/^lib\//, '');
    const matched = entry.includes('FliwrightBridge.init(') && entry.includes(`/${importPath}'`);
    result.checks.push({ name: 'bridge', status: matched ? 'passed' : 'pending', message: matched ? 'Bridge entrypoint references the selected App entrypoint.' : 'Review existing test_driver/fliwright_app.dart: ensure bridge initialization and selected App import match.' });
  }
  result.status = result.checks.some((check) => check.status === 'pending') ? 'needs-attention' : 'configured';
  result.nextSteps.push(...result.checks.filter((check) => check.status === 'pending').map((check) => check.message));
  if (hasFlutterProject) result.nextSteps.push('Start App: flutter run -t test_driver/fliwright_app.dart');
  result.nextSteps.push('Verify live connection: npx --no-install fliwright doctor --strict --json');
  if (options.agent) result.nextSteps.push('Open a new Codex chat in this project and ask Fliwright to inspect the App and capture a screenshot.');
  result.nextSteps.push('Replace Counter example selectors and assertions with your App widgets before running tests.');
  log('');
  log(`Setup ${result.status}. Live App verification has not run.`);
  for (const check of result.checks) log(`  ${check.status === 'passed' ? '✓' : '!'} ${check.name}: ${check.message}`);
  for (const step of result.nextSteps) log(`  ${step}`);
  return result;
}

async function writeIfAbsent(
  path: string,
  content: string,
  result: InitResult,
  log: (message: string) => void,
): Promise<void> {
  if (await fileExists(path)) {
    result.skipped.push(path);
    log(`${basename(path)} already exists - skipping.`);
    return;
  }
  await writeFile(path, content, 'utf8');
  result.created.push(path);
  log(`Created ${path}`);
}

async function ensurePackageJson(
  projectDir: string,
  result: InitResult,
  log: (message: string) => void,
): Promise<void> {
  const path = join(projectDir, 'package.json');
  const existed = await fileExists(path);
  const pkg = existed ? JSON.parse(await readFile(path, 'utf8')) as PackageJson : defaultPackageJson(projectDir);

  pkg.type ??= 'module';
  pkg.scripts = { ...DEFAULT_SCRIPTS, ...(pkg.scripts ?? {}) };
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}) };
  const cliManifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  const dependencies = { ...NODE_DEV_DEPENDENCIES, '@fliwright/cli': `^${cliManifest.version}`, '@fliwright/vitest': `^${cliManifest.version}` };
  for (const [name, version] of Object.entries(dependencies)) {
    pkg.devDependencies[name] ??= version;
  }

  await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  (existed ? result.updated : result.created).push(path);
  log(`${existed ? 'Updated' : 'Created'} package.json`);
}

function defaultPackageJson(projectDir: string): PackageJson {
  return {
    name: safePackageName(basename(projectDir)),
    private: true,
    type: 'module',
    scripts: {},
    devDependencies: {},
  };
}

async function ensureGitignore(
  projectDir: string,
  result: InitResult,
  log: (message: string) => void,
): Promise<void> {
  const path = join(projectDir, '.gitignore');
  const existing = await readTextIfExists(path);
  const currentLines = new Set(existing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = GITIGNORE_LINES.filter((line) => !currentLines.has(line));
  if (missing.length === 0) {
    result.skipped.push(path);
    log('.gitignore already covers Fliwright artifacts - skipping.');
    return;
  }
  const next = [existing.trimEnd(), ...missing].filter(Boolean).join('\n');
  await writeFile(path, `${next}\n`, 'utf8');
  (existing ? result.updated : result.created).push(path);
  log(`${existing ? 'Updated' : 'Created'} .gitignore`);
}

async function ensureFlutterEntry(
  projectDir: string,
  result: InitResult,
  log: (message: string) => void,
  entrypoint: string,
): Promise<void> {
  const pubspec = await readFile(join(projectDir, 'pubspec.yaml'), 'utf8');
  const packageName = parsePubspecName(pubspec) ?? safePackageName(basename(projectDir));
  await mkdir(join(projectDir, 'test_driver'), { recursive: true });
  await writeIfAbsent(
    join(projectDir, 'test_driver', 'fliwright_app.dart'),
    flutterEntryTemplate(packageName, entrypoint.replace(/^lib\//, '')),
    result,
    log,
  );
}

function flutterEntryTemplate(packageName: string, entrypoint: string): string {
  return `import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:${packageName}/${entrypoint}' as app;

Future<void> main() async {
  FliwrightRecordingBinding.ensureInitialized();
  await FliwrightBridge.init();
  app.main();
}
`;
}

async function detectPackageManager(projectDir: string): Promise<PackageManager> {
  const packageJson = await readPackageManagerField(projectDir);
  if (packageJson) return packageJson;
  if (await fileExists(join(projectDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fileExists(join(projectDir, 'yarn.lock'))) return 'yarn';
  if (await fileExists(join(projectDir, 'bun.lock')) || await fileExists(join(projectDir, 'bun.lockb'))) return 'bun';
  if (await fileExists(join(projectDir, 'package-lock.json'))) return 'npm';
  return 'npm';
}

async function readPackageManagerField(projectDir: string): Promise<PackageManager | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8')) as { packageManager?: string };
    const name = pkg.packageManager?.split('@')[0];
    return name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm' ? name : undefined;
  } catch {
    return undefined;
  }
}

async function runAndTrack(
  command: string,
  args: string[],
  cwd: string,
  result: InitResult,
  deps: InitDeps,
): Promise<void> {
  deps.signal?.throwIfAborted();
  result.commands.push({ command, args, cwd });
  if (deps.runCommand) await deps.runCommand(command, args, cwd);
  else await runCommand(command, args, cwd, deps.signal);
  deps.signal?.throwIfAborted();
}

function runCommand(command: string, args: string[], cwd: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32', signal });
    child.stdout?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code}: ${[command, ...args].join(' ')}`));
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

function parsePubspecName(pubspec: string): string | undefined {
  const match = /^name:\s*([A-Za-z0-9_]+)\s*$/m.exec(pubspec);
  return match?.[1];
}

function safePackageName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'fliwright-app';
}
