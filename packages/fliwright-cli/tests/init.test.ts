import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('initCommand', () => {
  let tmpDir: string;
  let logs: string[];
  let commands: Array<{ command: string; args: string[]; cwd: string }>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-init-'));
    logs = [];
    commands = [];
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates fliwright config, tsconfig, package scripts, gitignore, and an example test', async () => {
    await initCommand(tmpDir, { install: false }, { log: (message) => logs.push(message) });

    const config = await readFile(join(tmpDir, 'fliwright.config.ts'), 'utf8');
    const test = await readFile(join(tmpDir, 'tests', 'example.test.ts'), 'utf8');
    const tsconfig = await readFile(join(tmpDir, 'tsconfig.json'), 'utf8');
    const pkg = JSON.parse(await readFile(join(tmpDir, 'package.json'), 'utf8')) as {
      type: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const gitignore = await readFile(join(tmpDir, '.gitignore'), 'utf8');

    expect(config).toContain('defineConfig');
    expect(test).toContain("from '@fliwright/vitest'");
    expect(tsconfig).toContain('"moduleResolution": "Node16"');
    expect(tsconfig).toContain('".fliwright/tests/**/*.ts"');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts['test:fliwright']).toBe('fliwright run');
    expect(pkg.devDependencies['@fliwright/cli']).toBeDefined();
    expect(pkg.devDependencies['@fliwright/vitest']).toBeDefined();
    expect(gitignore).toContain('.fliwright/runs/');
  });

  it('does not overwrite existing fliwright.config.ts or package scripts', async () => {
    await writeFile(join(tmpDir, 'fliwright.config.ts'), 'existing', 'utf8');
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({
      scripts: {
        'test:fliwright': 'custom command',
      },
      devDependencies: {
        vitest: '^9.9.9',
      },
    }), 'utf8');

    await initCommand(tmpDir, { install: false }, { log: (message) => logs.push(message) });

    const config = await readFile(join(tmpDir, 'fliwright.config.ts'), 'utf8');
    const pkg = JSON.parse(await readFile(join(tmpDir, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(config).toBe('existing');
    expect(pkg.scripts['test:fliwright']).toBe('custom command');
    expect(pkg.devDependencies.vitest).toBe('^9.9.9');
    expect(pkg.devDependencies['@fliwright/cli']).toBeDefined();
  });

  it('creates a Flutter bridge entrypoint when pubspec.yaml exists', async () => {
    await writeFile(join(tmpDir, 'pubspec.yaml'), 'name: sample_app\n', 'utf8');

    await initCommand(tmpDir, { install: false }, { log: (message) => logs.push(message) });

    const entrypoint = await readFile(join(tmpDir, 'test_driver', 'fliwright_app.dart'), 'utf8');
    expect(entrypoint).toContain("import 'package:fliwright_bridge/fliwright_bridge.dart';");
    expect(entrypoint).toContain("import 'package:sample_app/main.dart' as app;");
    expect(entrypoint).toContain('await FliwrightBridge.init();');
    expect(entrypoint).toContain('app.main();');
  });

  it('runs package-manager and flutter install commands by default', async () => {
    await writeFile(join(tmpDir, 'pubspec.yaml'), 'name: sample_app\n', 'utf8');

    const result = await initCommand(tmpDir, { packageManager: 'pnpm' }, {
      log: (message) => logs.push(message),
      runCommand: async (command, args, cwd) => {
        commands.push({ command, args, cwd });
      },
    });

    expect(commands).toEqual([
      { command: 'pnpm', args: ['install'], cwd: tmpDir },
      { command: 'flutter', args: ['pub', 'add', 'fliwright_bridge'], cwd: tmpDir },
    ]);
    expect(result.commands).toEqual(commands);
  });

  it('skips dependency installation with install=false', async () => {
    await initCommand(tmpDir, { install: false }, {
      log: (message) => logs.push(message),
      runCommand: async (command, args, cwd) => {
        commands.push({ command, args, cwd });
      },
    });

    expect(commands).toEqual([]);
    expect(logs).toContain('Dependency installation skipped.');
  });
});
