import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : null;
if (!platform) {
  throw new Error(`Generated Flutter smoke is supported on macOS/Linux desktop, not ${process.platform}.`);
}

const artifactRoot = resolve(process.env.FLIWRIGHT_E2E_ARTIFACTS ?? join(root, '.fliwright', 'runs', 'generated-smoke'));
await mkdir(artifactRoot, { recursive: true });
const project = await mkdtemp(join(tmpdir(), 'fliwright-generated-e2e-'));
let appProcess;
const children = new Set();
let interrupted = false;
const interrupt = () => { interrupted = true; process.exitCode = 130; for (const child of children) void stopProcess(child); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
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
  const result = await run('node', [cli, 'run', '--test', '.fliwright/tests/smoke.test.ts', '--vm-url', vm.url, '--json', '--junit-output', join(artifactRoot, 'junit.xml'), '--runs-root', artifactRoot], project);
  const report = JSON.parse(await readFile(result.reportPath, 'utf8'));
  if (report.passed !== true || report.totalTests !== 1 || report.artifacts?.reportPath !== result.reportPath) {
    throw new Error(`Generated smoke report did not pass contract: ${JSON.stringify(report)}`);
  }
  const junit = await readFile(join(artifactRoot, 'junit.xml'), 'utf8');
  if (!junit.includes('<testsuite') || !junit.includes('failures="0"')) throw new Error('JUnit pass report is missing.');
  await stopProcess(appProcess); appProcess = undefined;
  const managed = await run('node', [cli, 'run', '--device-id', platform, '--test', '.fliwright/tests/smoke.test.ts', '--json', '--deadline', '180000', '--runs-root', artifactRoot], project);
  const managedEnvelope = JSON.parse(managed.stdout);
  if (!managedEnvelope.ok || managedEnvelope.data.passed !== true) throw new Error('Managed launch smoke failed.');
  await writeFile(join(project, '.fliwright', 'tests', 'smoke.test.ts'), testSource().replace("getByText('Count: 1')", "getByText('Count: 2')"));
  const failed = await run('node', [cli, 'run', '--device-id', platform, '--test', '.fliwright/tests/smoke.test.ts', '--json', '--deadline', '180000', '--junit-output', join(artifactRoot, 'failure-junit.xml'), '--runs-root', artifactRoot], project, 1);
  const failedEnvelope = JSON.parse(failed.stdout);
  const failedReport = JSON.parse(await readFile(failed.reportPath, 'utf8'));
  if (failedEnvelope.ok !== false || failedEnvelope.error?.code !== 'TEST_FAILED' || failedReport.failedTests !== 1) throw new Error('Failed managed run lost its evidence or exit code.');
  if (!(await readFile(join(artifactRoot, 'failure-junit.xml'), 'utf8')).includes('failures="1"')) throw new Error('JUnit failure report is missing.');
  const cancelled = await run('node', [cli, 'run', '--device-id', platform, '--json', '--deadline', '20', '--runs-root', artifactRoot], project, 5);
  if (JSON.parse(cancelled.stdout).error?.code !== 'DEADLINE_EXCEEDED') throw new Error('Managed startup deadline was not preserved.');
  console.log(`generated Flutter smoke passed: attach, managed launch, failure evidence, JUnit and startup cancellation (${artifactRoot})`);
} finally {
  await Promise.all([...children].map(stopProcess));
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
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
  if (interrupted) throw new Error('Smoke interrupted.');
  const child = spawn('flutter', ['run', '-d', device, '--debug'], {
    cwd: projectDir,
    detached: true,
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.once('close', () => children.delete(child));
  let spawnError; child.once('error', (error) => { spawnError = error; });
  let output = '';
  const onData = (chunk) => { output += chunk.toString(); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (interrupted || spawnError) break;
    const match = output.match(/A Dart VM Service[^\n]* available at:\s*(https?:\/\/\S+)/i);
    if (match) return { process: child, url: match[1].replace(/[\r\n]+$/, '') };
    if (child.exitCode !== null) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  await stopProcess(child);
  throw new Error(`Flutter app did not expose a VM Service URL. Output:\n${output}`);
}

function appSource() {
  return `import 'package:flutter/material.dart';\nimport 'package:fliwright_bridge/fliwright_bridge.dart';\n\nFuture<void> main() async {\n  await FliwrightBridge.init();\n  runApp(const MaterialApp(home: CounterPage()));\n}\n\nclass CounterPage extends StatefulWidget {\n  const CounterPage({super.key});\n  @override State<CounterPage> createState() => _CounterPageState();\n}\nclass _CounterPageState extends State<CounterPage> {\n  int count = 0;\n  @override Widget build(BuildContext context) => Scaffold(\n    body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [\n      Text('Count: $count'),\n      ElevatedButton(key: const Key('increment'), onPressed: () => setState(() => count++), child: const Text('Increment')),\n    ]),),\n  );\n}\n`;
}

function testSource() {
  return `import { test, expect } from '@fliwright/vitest';\n\ntest('generated app increments', async ({ page }) => {\n  await expect(page.getByText('Count: 0')).toBeVisible();\n  await page.getByKey('increment').click();\n  await expect(page.getByText('Count: 1')).toBeVisible();\n});\n`;
}

async function run(command, args, cwd, expectedExitCode = 0) {
  if (interrupted) throw new Error('Smoke interrupted.');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.once('close', () => children.delete(child));
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', async (code) => {
      await writeFile(join(artifactRoot, 'last-command.stdout.log'), stdout);
      await writeFile(join(artifactRoot, 'last-command.stderr.log'), stderr);
      if (code !== expectedExitCode || interrupted) {
        reject(new Error(`${command} ${args.join(' ')} failed with ${code}\n${stderr || stdout}`));
        return;
      }
      await writeFile(join(artifactRoot, 'last-command.stdout.log'), stdout);
      await writeFile(join(artifactRoot, 'last-command.stderr.log'), stderr);
      const reportPath = stdout.match(/"reportPath"\s*:\s*"([^"]+)"/)?.[1];
      resolvePromise({ stdout, stderr, reportPath });
    });
  });
}

async function stopProcess(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const stop = (signal) => { try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); } catch {} };
  stop('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) stop('SIGKILL');
}
