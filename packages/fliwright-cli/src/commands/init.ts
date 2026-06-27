import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const NODE_DEV_DEPENDENCIES: Record<string, string> = {
  '@fliwright/cli': '^0.1.0',
  '@fliwright/vitest': '^0.1.0',
  '@types/node': '^20.0.0',
  typescript: '^5.5.0',
  vitest: '^2.0.0',
};

const DEFAULT_SCRIPTS: Record<string, string> = {
  'test:fliwright': 'fliwright run',
  'doctor:fliwright': 'fliwright doctor',
  'record:fliwright': 'fliwright record',
};

const CONFIG_TEMPLATE = `import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  // vmServiceUrl: 'ws://127.0.0.1:8181/ws',
  timeout: 30000,
  screenshot: 'file',
  testDir: 'tests',
  reporter: 'pretty',
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
  "include": ["fliwright.config.ts", "tests/**/*.ts", ".fliwright/tests/**/*.ts"]
}
`;

const GITIGNORE_LINES = [
  '.fliwright/runs/',
  '.fliwright/ai/',
  '.fliwright/failures/',
];

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface InitOptions {
  install?: boolean;
  node?: boolean;
  flutter?: boolean;
  packageManager?: PackageManager;
}

export interface InitResult {
  created: string[];
  updated: string[];
  skipped: string[];
  commands: Array<{ command: string; args: string[]; cwd: string }>;
}

export interface InitDeps {
  log?: (message: string) => void;
  runCommand?: (command: string, args: string[], cwd: string) => Promise<void>;
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
  const result: InitResult = { created: [], updated: [], skipped: [], commands: [] };
  const install = options.install ?? true;
  const setupNode = options.node ?? true;
  const setupFlutter = options.flutter ?? true;

  await writeIfAbsent(join(projectDir, 'fliwright.config.ts'), CONFIG_TEMPLATE, result, log);
  await mkdir(join(projectDir, 'tests'), { recursive: true });
  await writeIfAbsent(join(projectDir, 'tests', 'example.test.ts'), EXAMPLE_TEST_TEMPLATE, result, log);
  await writeIfAbsent(join(projectDir, 'tsconfig.json'), TSCONFIG_TEMPLATE, result, log);
  await ensureGitignore(projectDir, result, log);

  if (setupNode) {
    await ensurePackageJson(projectDir, result, log);
  }

  const hasFlutterProject = await fileExists(join(projectDir, 'pubspec.yaml'));
  if (setupFlutter && hasFlutterProject) {
    await ensureFlutterEntry(projectDir, result, log);
  } else if (setupFlutter) {
    result.skipped.push('Flutter setup');
    log('No pubspec.yaml found - skipping Flutter bridge setup.');
  }

  if (install) {
    if (setupNode) {
      const packageManager = options.packageManager ?? await detectPackageManager(projectDir);
      await runAndTrack(packageManager, ['install'], projectDir, result, deps);
    }
    if (setupFlutter && hasFlutterProject) {
      await runAndTrack('flutter', ['pub', 'add', 'fliwright_bridge'], projectDir, result, deps);
    }
  } else {
    result.skipped.push('Dependency install');
    log('Dependency installation skipped.');
  }

  printNextSteps(log, hasFlutterProject);
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
  for (const [name, version] of Object.entries(NODE_DEV_DEPENDENCIES)) {
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
): Promise<void> {
  const pubspec = await readFile(join(projectDir, 'pubspec.yaml'), 'utf8');
  const packageName = parsePubspecName(pubspec) ?? safePackageName(basename(projectDir));
  await mkdir(join(projectDir, 'test_driver'), { recursive: true });
  await writeIfAbsent(
    join(projectDir, 'test_driver', 'fliwright_app.dart'),
    flutterEntryTemplate(packageName),
    result,
    log,
  );
}

function flutterEntryTemplate(packageName: string): string {
  return `import 'package:fliwright_bridge/fliwright_bridge.dart';
import 'package:${packageName}/main.dart' as app;

Future<void> main() async {
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
  result.commands.push({ command, args, cwd });
  await (deps.runCommand ?? runCommand)(command, args, cwd);
}

function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
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

function printNextSteps(log: (message: string) => void, hasFlutterProject: boolean): void {
  log('');
  log('Next steps:');
  if (hasFlutterProject) {
    log('  1. Start your Flutter app with the Fliwright bridge entrypoint:');
    log('     flutter run -t test_driver/fliwright_app.dart');
    log('  2. Run tests:');
    log('     npm run test:fliwright');
  } else {
    log('  1. Start your Flutter app with FliwrightBridge.init() enabled.');
    log('  2. Run tests: npm run test:fliwright');
  }
  log('  3. Check the environment any time: npm run doctor:fliwright');
}
