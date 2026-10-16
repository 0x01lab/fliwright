import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : null;
if (!platform) {
  throw new Error(`Generated Flutter smoke is supported on macOS/Linux desktop, not ${process.platform}.`);
}

const project = await mkdtemp(join(tmpdir(), 'fliwright-generated-e2e-'));
let appProcess;
try {
  await run('flutter', ['create', '--platforms', platform, '--project-name', 'generated_smoke', project], root);
  await addBridgeDependency(project);
  await writeFile(join(project, 'lib', 'main.dart'), appSource());
  await run('flutter', ['pub', 'get'], project);
  await linkNodePackages(project);
  await mkdir(join(project, '.fliwright', 'tests'), { recursive: true });
  await writeFile(join(project, '.fliwright', 'tests', 'smoke.test.ts'), testSource());

  const vm = await startFlutter(project, platform);
  appProcess = vm.process;
  const cli = join(root, 'packages', 'fliwright-cli', 'dist', 'index.js');
  const result = await run('node', [cli, 'run', '--test', '.fliwright/tests/smoke.test.ts', '--vm-url', vm.url, '--reporter', 'ai-json'], project);
  const report = JSON.parse(await readFile(result.reportPath, 'utf8'));
  if (report.passed !== true || report.totalTests !== 1 || report.artifacts?.reportPath !== result.reportPath) {
    throw new Error(`Generated smoke report did not pass contract: ${JSON.stringify(report)}`);
  }
  console.log(`generated Flutter smoke passed (${result.reportPath})`);
} finally {
  if (appProcess) appProcess.kill('SIGTERM');
  await rm(project, { recursive: true, force: true });
}

async function addBridgeDependency(projectDir) {
  const path = join(projectDir, 'pubspec.yaml');
  const yaml = await readFile(path, 'utf8');
  const dependency = `  fliwright_bridge:\n    path: ${join(root, 'packages', 'fliwright-bridge')}\n`;
  await writeFile(path, yaml.replace('dependencies:\n', `dependencies:\n${dependency}`));
}

async function linkNodePackages(projectDir) {
  const scope = join(projectDir, 'node_modules', '@fliwright');
  await mkdir(scope, { recursive: true });
  for (const name of ['core', 'vitest']) {
    await symlink(join(root, 'packages', `fliwright-${name}`), join(scope, name), 'dir');
  }
  await symlink(join(root, 'node_modules', 'vitest'), join(projectDir, 'node_modules', 'vitest'), 'dir');
}

async function startFlutter(projectDir, device) {
  const child = spawn('flutter', ['run', '-d', device, '--debug'], {
    cwd: projectDir,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const onData = (chunk) => { output += chunk.toString(); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const match = output.match(/A Dart VM Service[^\n]* available at:\s*(https?:\/\/\S+)/i);
    if (match) return { process: child, url: match[1].replace(/[\r\n]+$/, '') };
    if (child.exitCode !== null) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  child.kill('SIGTERM');
  throw new Error(`Flutter app did not expose a VM Service URL. Output:\n${output}`);
}

function appSource() {
  return `import 'package:flutter/material.dart';\nimport 'package:fliwright_bridge/fliwright_bridge.dart';\n\nFuture<void> main() async {\n  await FliwrightBridge.init();\n  runApp(const MaterialApp(home: CounterPage()));\n}\n\nclass CounterPage extends StatefulWidget {\n  const CounterPage({super.key});\n  @override State<CounterPage> createState() => _CounterPageState();\n}\nclass _CounterPageState extends State<CounterPage> {\n  int count = 0;\n  @override Widget build(BuildContext context) => Scaffold(\n    body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [\n      Text('Count: $count'),\n      ElevatedButton(key: const Key('increment'), onPressed: () => setState(() => count++), child: const Text('Increment')),\n    ]),),\n  );\n}\n`;
}

function testSource() {
  return `import { test, expect } from '@fliwright/vitest';\n\ntest('generated app increments', async ({ page }) => {\n  await expect(page.getByText('Count: 0')).toBeVisible();\n  await page.getByKey('increment').click();\n  await expect(page.getByText('Count: 1')).toBeVisible();\n});\n`;
}

async function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} failed with ${code}\n${stderr || stdout}`));
        return;
      }
      const reportPath = stdout.match(/"reportPath"\s*:\s*"([^"]+)"/)?.[1];
      resolvePromise({ stdout, stderr, reportPath });
    });
  });
}
