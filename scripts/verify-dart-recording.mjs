#!/usr/bin/env node
// Build core first. This exercises its public generator and runs the untouched
// output in the governed Flutter fixture, including a business counterexample.
import { mkdir, readFile, writeFile, rm, copyFile, cp, mkdtemp, symlink, realpath } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { applyDartVerification, generateRecordingAutomation } from '../packages/fliwright-core/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceAppDir = resolve(root, 'examples/form_demo');
// Flutter classifies integration tests using cwd containment. Resolve macOS's
// /var -> /private/var alias so an absolute test path matches the child's cwd.
const workRoot = await realpath(await mkdtemp(join(tmpdir(), 'fliwright-dart-app-')));
const appDir = resolve(workRoot, 'examples/form_demo');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const flutter = option('--flutter', 'flutter');
const output = resolve(option('--output', '/tmp/fliwright-dart-recording-acceptance'));
const device = option('--device', 'macos');
// Work in a temporary fixture copy: Flutter may migrate native project files.
const testPath = resolve(appDir, `integration_test/fliwright_generated_${process.pid}_test.dart`);
const report = { schemaVersion: 1, runId: `dart-recording-${randomUUID()}`, generatedAt: new Date().toISOString(), device,
  appEntrypoint: 'package:form_demo/recording_replay_main.dart', checks: [], status: 'running' };
await mkdir(output, { recursive: true });

async function run(name, commandArgs, expectedSuccess = true) {
  const startedAt = Date.now();
  const chunks = [];
  const logFile = createWriteStream(resolve(output, `${name}.log`));
  const child = spawn(flutter, commandArgs, { cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    chunks.push(chunk);
    logFile.write(chunk);
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolveExit(code));
  });
  await new Promise((finish) => logFile.end(finish));
  const log = Buffer.concat(chunks).toString('utf8');
  const passed = expectedSuccess ? exitCode === 0 : exitCode !== 0;
  report.checks.push({ name, command: [flutter, ...commandArgs], exitCode, expectedSuccess, passed,
    durationMs: Date.now() - startedAt, log: `${name}.log` });
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  if (!passed) throw new Error(`${name}: unexpected exit ${exitCode}; see ${output}/${name}.log`);
  console.log(`${name}: expected exit observed (${exitCode})`);
  return log;
}

const steps = [
  ['tap', 'counter_increment'],
  ['longPress', 'counter_increment'],
  ['tap', 'failure_probe_action'],
  ['tap', 'open_destroy_form'],
  ['type', 'destroy_form_input', 'draft'],
  ['type', 'destroy_form_input', ''],
  ['type', 'destroy_form_input', '<masked>'],
  ['tap', 'destroy_form_submit'],
];
const operations = steps.map(([kind, , text], index) => ({
  kind, timestamp: index * 1000, position: { x: 0, y: 0 },
  ...(kind === 'type' ? { text, action: 'replace' } : {}),
  ...(index === 6 ? { sensitive: true } : {}),
  ...(kind === 'longPress' ? { durationMs: 600 } : {}),
}));
const selectors = new Map(steps.map(([, key], index) => [index, {
  query: { match: { key, ...(index === 0 ? { type: 'FilledButton' } : {}) },
    ...(index === 3 ? { containing: { match: { type: 'Text', text: 'Open form' } } } : {}),
  }, ambiguous: false, matchCount: 1,
}]));
const checkpoints = [
  { id: 'counter', query: { match: { key: 'counter_value' } }, expected: 'Count: 11', afterOperationIndex: 1 },
  { id: 'business-result', query: { match: { key: 'failure_probe_result' } }, expected: 'Configured success', afterOperationIndex: 2 },
  { id: 'submitted-value', query: { match: { key: 'saved_value' } }, expected: 'Saved: fixture-replay-value', afterOperationIndex: 7 },
].map((item) => ({ ...item, matcher: 'toHaveText', source: 'snapshot', confirmed: true }));
const generated = generateRecordingAutomation({
  recording: { status: 'captured', operations, frames: [], code: '', issues: [], receivedSequences: [], missingSequences: [] },
  selectors, stopReason: 'requested',
}, { lang: 'dart', mode: 'test', dartAppEntrypoint: report.appEntrypoint,
  testName: 'Generated Dart recording replay', scenarioName: 'controlled-recording-fixture', checkpoints });
if (generated.readiness.readiness !== 'generated') throw new Error(generated.readiness.issues.join('; '));
report.contentFingerprint = createHash('sha256').update(generated.recording.code).digest('hex');
await writeFile(resolve(output, 'generated_test.dart'), generated.recording.code);
await writeFile(resolve(output, 'recording-input.json'), JSON.stringify({ operations, selectors: [...selectors], checkpoints }, null, 2));

try {
  await mkdir(resolve(workRoot, 'examples'), { recursive: true });
  await symlink(resolve(root, 'packages'), resolve(workRoot, 'packages'), 'dir');
  const generatedDirectories = new Set(['build', '.dart_tool', 'Pods', '.plugin_symlinks', 'ephemeral', '.fliwright', 'xcuserdata', '.idea', '.DS_Store']);
  await cp(sourceAppDir, appDir, { recursive: true,
    filter: (path) => !relative(sourceAppDir, path).split(sep).some((part) => generatedDirectories.has(part)),
  });
  await mkdir(dirname(testPath), { recursive: true });
  await copyFile(resolve(output, 'generated_test.dart'), testPath);
  report.flutterVersion = await run('flutter-version', ['--version']);
  // Resolve SDK-owned packages against the selected Flutter installation.
  // --enforce-lockfile prevents dependency upgrades while replacing stale SDK paths.
  await run('pub-get-locked', ['pub', 'get', '--enforce-lockfile']);
  await run('analyze-generated', ['analyze', '--no-pub', testPath, 'lib/recording_replay_main.dart']);
  const testArgs = ['test', '--no-pub', '-d', device, testPath, '--reporter', 'expanded'];
  const missingInput = await run('missing-input', testArgs, false);
  if (!missingInput.includes('Built build/macos/') && device === 'macos') {
    throw new Error('No macOS application build was observed; host-only tests do not prove device replay.');
  }
  if (!missingInput.includes('Missing recording input parameter: FLIWRIGHT_INPUT_7')) {
    throw new Error('Missing-input failure did not prove the input guard.');
  }
  const replay = [...testArgs, '--dart-define=FLIWRIGHT_INPUT_7=fixture-replay-value'];
  await run('positive-replay', replay);
  const negative = await run('business-counterexample', [...replay, '--dart-define=FLIWRIGHT_FIXTURE_FAIL=true'], false);
  if (!negative.includes('Configured failure') || !negative.includes('business-result')) {
    throw new Error('Counterexample did not fail at the generated business checkpoint.');
  }
  const after = await readFile(testPath, 'utf8');
  if (after !== generated.recording.code) throw new Error('Generated code changed before validation finished.');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await rm(testPath, { force: true });
  await rm(workRoot, { recursive: true, force: true });
  const verification = {
    status: report.status === 'passed' ? 'passed' : 'failed',
    runId: report.runId,
    contentFingerprint: report.contentFingerprint,
    appEntrypoint: report.appEntrypoint,
    platform: device,
    artifactPath: '.',
    ...(report.status === 'passed' ? {} : { issues: [report.error ?? 'Dart acceptance did not complete.'] }),
  };
  const readiness = applyDartVerification(generated.readiness, verification);
  if (report.status === 'passed' && readiness.readiness !== 'verified') {
    report.status = 'failed';
    report.error = readiness.issues.join('; ');
    verification.status = 'failed';
    verification.issues = readiness.issues;
    process.exitCode = 1;
  }
  report.verificationFile = 'verification.json';
  report.readinessFile = 'readiness.json';
  await writeFile(resolve(output, report.verificationFile), JSON.stringify(verification, null, 2) + '\n');
  await writeFile(resolve(output, report.readinessFile), JSON.stringify(readiness, null, 2) + '\n');
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Evidence: ${output}/acceptance.json`);
}
