#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(__dirname, '..', 'templates');
const MARKER_START = '<!-- FLIWRIGHT-PLUGIN-START -->';
const MARKER_END = '<!-- FLIWRIGHT-PLUGIN-END -->';

export interface SetupOptions {
  force?: boolean;
}

export interface ParsedArgs extends SetupOptions {
  platform: 'all' | 'claude' | 'codex';
  targetDir: string;
}

export function validateTargetDir(targetDir: string): void {
  const markers = ['pubspec.yaml', 'package.json', '.git', '.fliwright'];
  const found = markers.some((m) => existsSync(join(targetDir, m)));
  if (!found) {
    throw new Error(
      `Error: "${targetDir}" does not appear to be a project root.\n` +
        'Expected at least one of: pubspec.yaml, package.json, .git, .fliwright\n' +
        'Use --target <dir> to specify the project directory.',
    );
  }
}

export function setupClaudeCode(targetDir: string, options: SetupOptions = {}): void {
  const src = join(TEMPLATES, 'claude-code', 'fliwright');
  const dest = join(targetDir, '.claude', 'skills', 'fliwright');

  if (existsSync(dest) && !options.force) {
    throw new Error(
      `Claude Code skill already exists at ${dest}.\n` +
        'Re-run with --force to replace it, or move the existing skill aside first.',
    );
  }

  try {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    console.log(`✓ Claude Code skill installed → ${dest}`);
  } catch (e) {
    throw new Error(`Error: Failed to install Claude Code skill: ${e instanceof Error ? e.message : e}`);
  }
}

export function setupCodex(targetDir: string): void {
  const src = join(TEMPLATES, 'codex', 'fliwright.md');
  const dest = join(targetDir, 'AGENTS.md');

  let content: string;
  try {
    content = readFileSync(src, 'utf-8');
  } catch (e) {
    throw new Error(`Error: Template not found: ${src}`);
  }

  const injected = `${MARKER_START}\n${content}\n${MARKER_END}`;

  try {
    if (!existsSync(dest)) {
      writeFileSync(dest, injected + '\n');
      console.log(`✓ Codex instructions installed → ${dest}`);
      return;
    }

    const existing = readFileSync(dest, 'utf-8');
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      if (startIdx >= endIdx) {
        throw new Error('Error: Corrupted FLIWRIGHT markers in AGENTS.md. Manual fix required.');
      }
      const updated =
        existing.substring(0, startIdx) + injected + existing.substring(endIdx + MARKER_END.length);
      writeFileSync(dest, updated);
    } else if (startIdx !== -1 || endIdx !== -1) {
      throw new Error('Error: Orphaned FLIWRIGHT marker in AGENTS.md. Manual fix required.');
    } else {
      writeFileSync(dest, existing + '\n\n' + injected + '\n');
    }
    console.log(`✓ Codex instructions updated → ${dest}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Error:')) {
      throw e;
    }
    throw new Error(`Error: Failed to update AGENTS.md: ${e instanceof Error ? e.message : e}`);
  }
}

export function parseArgs(args: string[], cwd = process.cwd()): ParsedArgs {
  let targetDir = resolve(cwd);
  let platform: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') {
      platform = 'all';
    } else if (arg === '--force') {
      force = true;
    } else if (arg === '--target') {
      if (!args[i + 1]) {
        throw new Error('Error: --target requires a directory.');
      }
      targetDir = resolve(cwd, args[++i]);
    } else if (arg === 'claude' || arg === 'codex') {
      platform = arg;
    } else {
      throw new Error(`Error: Unknown argument "${arg}".`);
    }
  }

  if (!platform) {
    throw new Error(usage());
  }

  if (platform !== 'all' && platform !== 'claude' && platform !== 'codex') {
    throw new Error(usage());
  }

  return { platform, targetDir, force };
}

export function runSetup(parsed: ParsedArgs): void {
  validateTargetDir(parsed.targetDir);

  if (parsed.platform === 'all' || parsed.platform === 'claude') {
    setupClaudeCode(parsed.targetDir, { force: parsed.force });
  }
  if (parsed.platform === 'all' || parsed.platform === 'codex') setupCodex(parsed.targetDir);

  console.log('\nDone! Restart your AI assistant to pick up the changes.');
  console.log('MCP tools require the fliwright MCP server to be configured separately.');
}

function usage(): string {
  return [
    'Usage: fliwright-ai-setup [--all | claude | codex] [--target <dir>] [--force]',
    '',
    '  --all            Install for Claude Code + Codex CLI',
    '  claude           Install Claude Code skill only',
    '  codex            Install Codex CLI instructions only',
    '  --target <dir>   Target project directory (default: current directory)',
    '  --force          Replace an existing Claude Code fliwright skill',
  ].join('\n');
}

function main(): void {
  try {
    runSetup(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
