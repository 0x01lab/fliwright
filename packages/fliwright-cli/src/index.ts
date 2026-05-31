#!/usr/bin/env node
import { Command } from 'commander';
import { runCommand } from './commands/run.js';
import { initCommand } from './commands/init.js';
import { doctorCommand } from './commands/doctor.js';

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

  program.parse();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
