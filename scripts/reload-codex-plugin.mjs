#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const defaultPluginPath = path.join(root, 'plugins/fliwright');
const repoMarketplacePath = path.join(root, '.agents/plugins/marketplace.json');
const defaultMarketplacePath = path.join(os.homedir(), '.agents/plugins/marketplace.json');

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const pluginRoot = path.resolve(root, options.pluginPath ?? process.env.FLIWRIGHT_CODEX_PLUGIN_PATH ?? defaultPluginPath);
const manifestPath = path.join(pluginRoot, '.codex-plugin/plugin.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing plugin manifest: ${manifestPath}`);
  console.error('Pass --plugin <path> or set FLIWRIGHT_CODEX_PLUGIN_PATH when testing a plugin outside plugins/fliwright.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (typeof manifest.name !== 'string' || !manifest.name.trim()) {
  console.error('plugin.json must contain a non-empty `name`.');
  process.exit(1);
}
if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
  console.error('plugin.json must contain a non-empty `version`.');
  process.exit(1);
}

const cachebuster = sanitizeCachebuster(options.cachebuster ?? defaultCachebuster());
const previousVersion = manifest.version;
const nextVersion = withCachebuster(previousVersion, cachebuster);
const marketplaceName = options.marketplace ?? process.env.FLIWRIGHT_CODEX_MARKETPLACE ?? readMarketplaceName(options.marketplacePath);
const installCommand = ['plugin', 'add', `${manifest.name}@${marketplaceName}`];

if (options.dryRun) {
  console.log(`Would update ${path.relative(root, manifestPath)}: ${previousVersion} -> ${nextVersion}`);
  console.log(`Would run: codex ${installCommand.join(' ')}`);
  process.exit(0);
}

manifest.version = nextVersion;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Updated plugin version: ${previousVersion} -> ${nextVersion}`);

if (options.noInstall) {
  console.log('Skipped reinstall because --no-install was passed.');
  console.log('Open a new Codex task after reinstalling to pick up changed skills and MCP tools.');
  process.exit(0);
}

const result = spawnSync('codex', installCommand, {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (result.status !== 0) {
  console.error(`codex ${installCommand.join(' ')} failed.`);
  process.exit(result.status ?? 1);
}

console.log('Reinstalled plugin. Open a new Codex task to pick up changed skills and MCP tools.');

function parseArgs(argv) {
  const parsed = {
    pluginPath: undefined,
    marketplace: undefined,
    marketplacePath: undefined,
    cachebuster: undefined,
    dryRun: false,
    noInstall: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--plugin') {
      parsed.pluginPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--marketplace') {
      parsed.marketplace = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--marketplace-path') {
      parsed.marketplacePath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--cachebuster') {
      parsed.cachebuster = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--no-install') {
      parsed.noInstall = true;
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

function printHelp() {
  console.log(`Usage: node scripts/reload-codex-plugin.mjs [options]

Options:
  --plugin <path>             Plugin root. Defaults to plugins/fliwright or FLIWRIGHT_CODEX_PLUGIN_PATH.
  --marketplace <name>        Marketplace name. Defaults to FLIWRIGHT_CODEX_MARKETPLACE or marketplace.json name.
  --marketplace-path <path>   Marketplace JSON to read when --marketplace is omitted.
  --cachebuster <token>       Override the timestamp cachebuster.
  --dry-run                   Print the version/install changes without writing or installing.
  --no-install                Update the cachebuster but skip codex plugin add.
`);
}

function readMarketplaceName(marketplacePath) {
  const targetPath = marketplacePath
    ? path.resolve(root, marketplacePath)
    : fs.existsSync(repoMarketplacePath)
      ? repoMarketplacePath
      : defaultMarketplacePath;

  if (!fs.existsSync(targetPath)) return 'personal';
  try {
    const marketplace = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    return typeof marketplace.name === 'string' && marketplace.name.trim()
      ? marketplace.name.trim()
      : 'personal';
  } catch {
    return 'personal';
  }
}

function sanitizeCachebuster(value) {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!sanitized) throw new Error('Cachebuster must contain at least one letter or digit.');
  return sanitized;
}

function defaultCachebuster() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function withCachebuster(version, cachebuster) {
  const versionPrefix = version.split('+', 1)[0];
  return `${versionPrefix}+codex.${cachebuster}`;
}
