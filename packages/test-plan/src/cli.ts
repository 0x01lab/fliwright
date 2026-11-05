#!/usr/bin/env node
import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fetchItems, assemblePlan, validatePlan, bindCase, updateAutomation } from './Plan.js';
import { ZodError } from 'zod';
import { generateCoverage } from './Coverage.js';

/** Independent CLI; no Fliwright session, VM service or test framework is loaded. */
export async function executeCli(argv: string[], input: { stdin?: string } = {}) {
  let stdout = '', stderr = '', exitCode = 0;
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException('Cancelled.', 'AbortError'));
  const stdinOptions = async (...paths: Array<string | undefined>) => {
    if (paths.filter(path => path === '-').length > 1) throw new Error('Only one JSON input can use stdin (-) per command.');
    if (!paths.includes('-')) return {};
    if (input.stdin !== undefined) return { stdin: input.stdin };
    if (process.stdin.isTTY) throw new Error('Pipe JSON to stdin when using an input path of -.');
    const cancel = () => process.stdin.destroy(controller.signal.reason as Error);
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      process.stdin.setEncoding('utf8');
      let stdin = '';
      for await (const chunk of process.stdin) { controller.signal.throwIfAborted(); stdin += chunk; }
      return { stdin };
    } finally { controller.signal.removeEventListener('abort', cancel); }
  };
  const program = new Command().name('test-plan').description('Fetch GitLab snapshots and validate skill-authored test plans');
  program.exitOverride().configureOutput({ writeOut: text => { stdout += text; }, writeErr: text => { stderr += text; } });
  const positive = (value: string) => { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('timeout must be a positive integer.'); return parsed; };
  program.command('fetch').argument('<items...>', 'HTTPS GitLab Issue or Work Item URLs')
    .requiredOption('--output <path>', 'New source snapshot JSON file; never overwrites')
    .option('--cwd <path>', 'Working directory', process.cwd())
    .option('--timeout <ms>', 'Timeout for each GitLab process', positive, 120000)
    .action(async (items, options) => {
      const result = await fetchItems({ items, output: options.output, cwd: options.cwd, timeoutMs: options.timeout, signal: controller.signal });
      stdout += JSON.stringify({ output: result.output, items: result.snapshot.items.length }) + '\n';
    });
  program.command('assemble').requiredOption('--snapshot <path>', 'GitLab source snapshot JSON file, or - for stdin')
    .requiredOption('--draft <path>', 'Skill-authored draft JSON file, or - for stdin')
    .requiredOption('--output <path>', 'New validated plan JSON file; never overwrites')
    .option('--cwd <path>', 'Working directory', process.cwd())
    .action(async options => {
      const result = await assemblePlan({ ...options, ...await stdinOptions(options.snapshot, options.draft), signal: controller.signal });
      stdout += JSON.stringify({ output: result.output, ...await validatePlan({ plan: result.output, signal: controller.signal }) }) + '\n';
    });
  program.command('validate').argument('<plan>', 'Test plan JSON to validate')
    .option('--cwd <path>', 'Working directory', process.cwd())
    .option('--catalog <path>', 'Collected Fliwright catalog JSON file, or - for stdin')
    .option('--require-scripts', 'Exit 1 unless all cases have complete scripts verified against the catalog')
    .action(async (plan, options) => {
      const result = await validatePlan({ ...options, plan, ...await stdinOptions(options.catalog), signal: controller.signal });
      stdout += JSON.stringify(result) + '\n';
      if (options.requireScripts && !result.scriptsReady) exitCode = 1;
    });
  program.command('update').argument('<plan>')
    .requiredOption('--updates <path>', 'JSON coverage decisions file, or - for stdin')
    .option('--output <path>', 'Write a new plan instead of atomically updating the input plan')
    .option('--catalog <path>', 'Collected catalog JSON file or - for stdin; required when referencing tests')
    .option('--cwd <path>', 'Working directory', process.cwd())
    .action(async (plan, options) => {
      const supplied = await stdinOptions(options.updates, options.catalog);
      const result = await updateAutomation({ ...options, plan, ...supplied, signal: controller.signal });
      stdout += JSON.stringify({ output: result.output, ...await validatePlan({ plan: result.output, catalog: options.catalog, cwd: options.cwd, ...supplied, signal: controller.signal }) }) + '\n';
    });
  program.command('bind').argument('<plan>').argument('<caseId>')
    .requiredOption('--catalog <path>', 'Collected Fliwright catalog JSON file, or - for stdin')
    .requiredOption('--file <path>', 'Project-relative automation test file').requiredOption('--name <title>', 'Full automation test title')
    .option('--output <path>', 'Write a new plan instead of atomically updating the input plan').option('--cwd <path>', 'Working directory', process.cwd())
    .action(async (plan, caseId, options) => {
      const result = await bindCase({ ...options, plan, caseId, ...await stdinOptions(options.catalog), signal: controller.signal });
      stdout += JSON.stringify({ output: result.output, caseId }) + '\n';
    });
  program.command('coverage').argument('<plan>', 'Canonical test plan JSON')
    .option('--output <path>', 'Regenerate coverage.md beside the plan, or - for Markdown on stdout')
    .option('--cwd <path>', 'Working directory', process.cwd())
    .action(async (plan, options) => {
      const result = await generateCoverage({ ...options, plan, signal: controller.signal });
      stdout += result.output === '-' ? result.content : JSON.stringify({ output: result.output }) + '\n';
    });
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try { await program.parseAsync(argv, { from: 'user' }); return { stdout, stderr, exitCode }; }
  catch (error) {
    if ((error as { code?: string }).code === 'commander.helpDisplayed') return { stdout, stderr, exitCode: 0 };
    const exitCode = controller.signal.aborted ? 130 : error instanceof ZodError || String((error as { code?: string }).code).startsWith('commander.') ? 2 : 3;
    return { stdout, stderr: `${stderr}${error instanceof Error ? error.message : String(error)}\n`, exitCode };
  } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))) {
  void executeCli(process.argv.slice(2)).then(result => { process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.exitCode; });
}
