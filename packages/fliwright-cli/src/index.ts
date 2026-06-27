#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { recordCommand } from './commands/record.js';
import { mockStartCommand } from './commands/mock.js';
import { tddCycleCommand, tddStatusCommand, tddSyncCommand } from './commands/tdd.js';
import type { PackageManager } from './commands/init.js';

async function main() {
  const program = new Command();

  program
    .name('fliwright')
    .description('AI-native testing framework for Flutter')
    .version('0.1.0');

  program
    .command('run')
    .description('Run Fliwright tests')
    .option('--test <pattern>', 'Test file or glob pattern')
    .option('--test-name <pattern>', 'Run only tests matching this name')
    .option('--vm-url <url>', 'Dart VM Service WebSocket URL')
    .option('--reporter <format>', 'Output format: pretty, json, ai-json, junit', 'pretty')
    .option('--timeout <ms>', 'Per-test timeout in milliseconds', '30000')
    .option('--screenshot <mode>', 'Screenshot mode: file, base64, off', 'file')
    .option('--output <file>', 'Write the AI run report JSON to this file')
    .action(async (opts) => {
      const result = await runCommand({
        testPattern: opts.test,
        testName: opts.testName,
        vmUrl: opts.vmUrl,
        reporter: opts.reporter as 'pretty' | 'json' | 'ai-json' | 'junit',
        timeout: Number(opts.timeout),
        screenshot: opts.screenshot as 'file' | 'base64' | 'off',
        output: opts.output,
      });

      process.exit(result.passed ? 0 : 1);
    });

  program
    .command('init')
    .description('Initialize Fliwright in the current project')
    .option('--no-install', 'Write files only; do not install Node or Flutter dependencies')
    .option('--no-node', 'Skip package.json, scripts, and Node dependency setup')
    .option('--no-flutter', 'Skip Flutter bridge setup')
    .option('--pm <manager>', 'Package manager for Node dependencies: npm, pnpm, yarn, bun')
    .action(async (opts) => {
      if (opts.pm && !isPackageManager(opts.pm)) {
        throw new Error(`Unsupported package manager: ${opts.pm}`);
      }
      await initCommand(process.cwd(), {
        install: opts.install,
        node: opts.node,
        flutter: opts.flutter,
        packageManager: opts.pm,
      });
    });

  program
    .command('doctor')
    .description('Check your Fliwright environment')
    .option('--vm-url <url>', 'Dart VM Service URL for runtime bridge checks')
    .action(async (opts) => {
      await doctorCommand(process.cwd(), { vmServiceUrl: opts.vmUrl });
    });

  program
    .command('record')
    .description('Record user interactions and generate test code')
    .option('--vm-url <url>', 'Dart VM Service WebSocket URL')
    .option('--output <file>', 'Output file path')
    .option('--lang <lang>', 'Output language: ts, dart', 'ts')
    .option('--name <name>', 'Test name', 'recorded test')
    .option('--home-route <route>', 'Route to navigate to before each generated TS test', '/')
    .option('--no-reset-home', 'Do not generate a beforeEach hook that navigates to the home route')
    .action(async (opts) => {
      try {
        await recordCommand({
          vmUrl: opts.vmUrl,
          output: opts.output,
          lang: opts.lang as 'ts' | 'dart',
          testName: opts.name,
          resetToHomeBeforeEach: opts.resetHome,
          homeRoute: opts.homeRoute,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program
    .command('mock:start')
    .description('Start the Fliwright tool-side mock controller')
    .option('--host <host>', 'Host to bind', '127.0.0.1')
    .option('--port <port>', 'Port to bind. Defaults to a random free port')
    .option('--mock-dir <dir>', 'Mock directory. Defaults to .fliwright/mocks')
    .action(async (opts) => {
      try {
        await mockStartCommand({
          host: opts.host,
          port: opts.port === undefined ? undefined : Number(opts.port),
          mockDir: opts.mockDir,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  const tdd = program
    .command('tdd')
    .description('Run and inspect the Fliwright TDD loop');

  tdd
    .command('cycle')
    .description('Start a temporary TDD runtime, focus one test, run one cycle, then stop')
    .requiredOption('--config <path>', 'Vitest config file or project root')
    .requiredOption('--file <path>', 'Focused test file')
    .option('--test-name <name>', 'Focused test name or regex text')
    .option('--vm-url <url>', 'Attach to an already-running Flutter VM Service WebSocket URL')
    .option('--device-id <id>', 'Flutter daemon device id to launch')
    .option('--project-id <path>', 'Flutter project directory/id for app.start')
    .option('--target <path>', 'Flutter target file, usually lib/main.dart')
    .option('--flutter-arg <arg...>', 'Extra flutter run argument(s) for app.start')
    .option('--mode <mode>', 'Flutter daemon app.start mode: run, drive')
    .option('--sync <mode>', 'App sync before the cycle: none, reload, restart, auto', 'none')
    .option('--change <path...>', 'Changed file path(s), used when --sync auto')
    .option('--full-reset', 'Force a full baseline reset')
    .option('--no-auto-escalate', 'Do not retry structural-looking reload failures with restart')
    .option('--timeout <ms>', 'Per-cycle timeout in milliseconds')
    .option('--home-route <route>', 'Scenario home route', '/')
    .option('--reset-category <category...>', 'Scenario reset categories')
    .option('--riverpod-override-json <json...>', 'Riverpod override JSON object(s): { provider | key, value }')
    .option('--mock-profile <name>', 'Mock rule profile to switch during baseline reset')
    .option('--mock-dir <path>', 'Mock rules directory used with --mock-profile')
    .option('--storage-seed-json <json>', 'JSON object passed to the storage reset adapter')
    .option('--status-file <path>', 'Path to write the RuntimeSnapshot status JSON')
    .option('--keep-app-alive', 'Do not stop the daemon-started Flutter app after the cycle')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      try {
        const result = await tddCycleCommand({
          configRoot: opts.config,
          file: opts.file,
          testName: opts.testName,
          vmUrl: opts.vmUrl,
          deviceId: opts.deviceId,
          projectId: opts.projectId,
          target: opts.target,
          flutterArgs: opts.flutterArg,
          mode: opts.mode as 'run' | 'drive' | undefined,
          sync: opts.sync as 'none' | 'reload' | 'restart' | 'auto',
          changes: opts.change,
          fullReset: opts.fullReset,
          autoEscalate: opts.autoEscalate,
          timeoutMs: opts.timeout === undefined ? undefined : Number(opts.timeout),
          homeRoute: opts.homeRoute,
          resetCategories: opts.resetCategory,
          riverpodOverrideJson: opts.riverpodOverrideJson,
          mockProfile: opts.mockProfile,
          mockDir: opts.mockDir,
          storageSeedJson: opts.storageSeedJson,
          statusFile: opts.statusFile,
          keepAppAlive: opts.keepAppAlive,
          json: opts.json,
        });
        process.exit(result.result.status === 'green' ? 0 : 1);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  tdd
    .command('sync')
    .description('Start a temporary TDD runtime, manually sync the app, then stop')
    .requiredOption('--config <path>', 'Vitest config file or project root')
    .argument('<mode>', 'Sync mode: none, reload, restart')
    .option('--vm-url <url>', 'Attach to an already-running Flutter VM Service WebSocket URL')
    .option('--device-id <id>', 'Flutter daemon device id to launch')
    .option('--project-id <path>', 'Flutter project directory/id for app.start')
    .option('--target <path>', 'Flutter target file, usually lib/main.dart')
    .option('--flutter-arg <arg...>', 'Extra flutter run argument(s) for app.start')
    .option('--mode <mode>', 'Flutter daemon app.start mode: run, drive')
    .option('--status-file <path>', 'Path to write the RuntimeSnapshot status JSON')
    .option('--keep-app-alive', 'Do not stop the daemon-started Flutter app after the sync')
    .option('--json', 'Print JSON output')
    .action(async (mode, opts) => {
      try {
        await tddSyncCommand({
          configRoot: opts.config,
          vmUrl: opts.vmUrl,
          deviceId: opts.deviceId,
          projectId: opts.projectId,
          target: opts.target,
          flutterArgs: opts.flutterArg,
          mode: opts.mode as 'run' | 'drive' | undefined,
          sync: mode as 'none' | 'reload' | 'restart',
          statusFile: opts.statusFile,
          keepAppAlive: opts.keepAppAlive,
          json: opts.json,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  tdd
    .command('status')
    .description('Read the latest TDD runtime status file')
    .requiredOption('--config <path>', 'Vitest config file or project root')
    .option('--status-file <path>', 'Path to the RuntimeSnapshot status JSON')
    .option('--json', 'Print JSON output')
    .action(async (opts) => {
      try {
        await tddStatusCommand({
          configRoot: opts.config,
          statusFile: opts.statusFile,
          json: opts.json,
        });
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program.parse();
}

function isPackageManager(value: string): value is PackageManager {
  return value === 'npm' || value === 'pnpm' || value === 'yarn' || value === 'bun';
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
