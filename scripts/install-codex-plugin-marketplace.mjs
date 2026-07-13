#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const marketplace = resolveMarketplace(options.marketplacePath);
const marketplaceRoot = marketplace.root;
const marketplacePath = marketplace.manifestPath;

if (!fs.existsSync(marketplacePath)) {
  console.error(`Missing marketplace manifest: ${marketplacePath}`);
  console.error('Pass --path <repository-root> for a different marketplace source.');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
} catch (error) {
  console.error(`Could not parse marketplace manifest: ${marketplacePath}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
  console.error('marketplace.json must contain a non-empty `name`.');
  process.exit(1);
}

if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
  console.error('marketplace.json must contain at least one plugin entry.');
  process.exit(1);
}

const command = ['plugin', 'marketplace', 'add', marketplaceRoot];

if (options.dryRun) {
  console.log(`Marketplace: ${manifest.name}`);
  console.log(`Manifest: ${marketplacePath}`);
  console.log(`Would run: codex ${command.join(' ')}`);
  process.exit(0);
}

const result = spawnSync('codex', command, {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error(`codex ${command.join(' ')} failed.`);
  process.exit(result.status ?? 1);
}

console.log(`Registered local marketplace: ${manifest.name}`);

function parseArgs(argv) {
  const parsed = {
    marketplacePath: undefined,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--path') {
      parsed.marketplacePath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function resolveMarketplace(rawPath) {
  const candidateRoot = path.resolve(root, rawPath ?? root);
  const manifestPath = path.join(candidateRoot, '.agents/plugins/marketplace.json');
  if (fs.existsSync(manifestPath)) {
    return { root: candidateRoot, manifestPath };
  }

  // Accept the old --path .agents/plugins form, but register the repository
  // root that Codex uses to discover the nested marketplace manifest.
  if (path.basename(candidateRoot) === 'plugins' && path.basename(path.dirname(candidateRoot)) === '.agents') {
    const repositoryRoot = path.dirname(path.dirname(candidateRoot));
    return {
      root: repositoryRoot,
      manifestPath: path.join(candidateRoot, 'marketplace.json'),
    };
  }

  return { root: candidateRoot, manifestPath };
}

function printHelp() {
  console.log(`Usage: node scripts/install-codex-plugin-marketplace.mjs [options]

Options:
  --path <repository-root>   Repository root containing .agents/plugins/marketplace.json.
  --dry-run                  Print the Codex command without registering.
  --help, -h                 Show this help.
`);
}
