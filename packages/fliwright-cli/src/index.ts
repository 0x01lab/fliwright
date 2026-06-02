#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';
import { recordCommand } from './commands/record.js';
import { mockStartCommand } from './commands/mock.js';

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
    .option('--vm-url <url>', 'Dart VM Service WebSocket URL')
    .option('--reporter <format>', 'Output format: pretty, json, junit', 'pretty')
    .option('--timeout <ms>', 'Per-test timeout in milliseconds', '30000')
    .option('--screenshot <mode>', 'Screenshot mode: file, base64, off', 'file')
    .action(async (opts) => {
      const result = await runCommand({
        testPattern: opts.test,
        vmUrl: opts.vmUrl,
        reporter: opts.reporter as 'pretty' | 'json' | 'junit',
        timeout: Number(opts.timeout),
        screenshot: opts.screenshot as 'file' | 'base64' | 'off',
      });

      process.exit(result.passed ? 0 : 1);
    });

  program
    .command('init')
    .description('Initialize Fliwright in the current project')
    .action(async () => {
      await initCommand(process.cwd());
    });

  program
    .command('doctor')
    .description('Check your Fliwright environment')
    .action(async () => {
      await doctorCommand(process.cwd());
    });

  program
    .command('record')
    .description('Record user interactions and generate test code')
    .option('--vm-url <url>', 'Dart VM Service WebSocket URL')
    .option('--output <file>', 'Output file path')
    .option('--lang <lang>', 'Output language: ts, dart', 'ts')
    .option('--name <name>', 'Test name', 'recorded test')
    .action(async (opts) => {
      try {
        await recordCommand({
          vmUrl: opts.vmUrl,
          output: opts.output,
          lang: opts.lang as 'ts' | 'dart',
          testName: opts.name,
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

  program.parse();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
