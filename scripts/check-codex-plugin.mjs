#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const defaultPluginPath = path.join(root, 'plugins/fliwright');
const pluginCreatorRoot = path.join(os.homedir(), '.codex/skills/.system/plugin-creator');
const skillCreatorRoot = path.join(os.homedir(), '.codex/skills/.system/skill-creator');
const bundledSkillNames = [
  'fliwright-tdd',
  'write-fliwright-mock-rules',
  'write-fliwright-tests',
];
const commandEnv = {
  ...process.env,
  FLIWRIGHT_RUNS_ROOT: process.env.FLIWRIGHT_RUNS_ROOT ?? path.join(os.tmpdir(), 'fliwright-plugin-check-runs'),
};
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
let cachedPythonHasYaml;

const options = parseArgs(process.argv.slice(2));
const results = [];

if (options.help) {
  printHelp();
  process.exit(0);
}

const pluginRoot = path.resolve(root, options.pluginPath ?? process.env.FLIWRIGHT_CODEX_PLUGIN_PATH ?? defaultPluginPath);
const pluginManifestPath = path.join(pluginRoot, '.codex-plugin/plugin.json');
const skillRoot = fs.existsSync(path.join(pluginRoot, 'skills'))
  ? path.join(pluginRoot, 'skills')
  : path.join(root, '.agents/skills');

if (!options.skipMcp) {
  runCommand('MCP build', 'pnpm', ['--filter', '@fliwright/mcp', 'build']);
  runCommand('MCP tests', 'pnpm', ['--filter', '@fliwright/mcp', 'test']);
}

if (!options.skipManifest) {
  validatePluginManifest(pluginRoot, pluginManifestPath);
}

if (!options.skipSkills) {
  validateSkills(skillRoot);
}

printSummary();
process.exit(results.some((result) => result.status === 'fail') ? 1 : 0);

function parseArgs(argv) {
  const parsed = {
    pluginPath: undefined,
    strictPlugin: false,
    skipMcp: false,
    skipManifest: false,
    skipSkills: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--plugin') {
      parsed.pluginPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--strict-plugin') {
      parsed.strictPlugin = true;
    } else if (arg === '--skip-mcp') {
      parsed.skipMcp = true;
    } else if (arg === '--skip-manifest') {
      parsed.skipManifest = true;
    } else if (arg === '--skip-skills') {
      parsed.skipSkills = true;
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
  console.log(`Usage: node scripts/check-codex-plugin.mjs [options]

Options:
  --plugin <path>     Plugin root. Defaults to plugins/fliwright or FLIWRIGHT_CODEX_PLUGIN_PATH.
  --strict-plugin    Fail when the plugin manifest is missing.
  --skip-mcp         Skip @fliwright/mcp build and tests.
  --skip-manifest    Skip plugin manifest validation.
  --skip-skills      Skip skill validation.
`);
}

function runCommand(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: commandEnv,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status === 0) {
    pass(label, `${command} ${args.join(' ')}`);
    return;
  }

  const details = [
    `${command} ${args.join(' ')}`,
    result.stdout?.trim(),
    result.stderr?.trim(),
  ].filter(Boolean).join('\n');
  fail(label, details || `Command exited with ${result.status ?? 'unknown status'}.`);
}

function validatePluginManifest(pluginRoot, manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    const message = `No plugin manifest at ${path.relative(root, manifestPath)}. Use --plugin when testing a different plugin root.`;
    if (options.strictPlugin) fail('Plugin manifest', message);
    else warn('Plugin manifest', `${message} Repository skills and MCP package will still be checked.`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail('Plugin manifest', `Invalid JSON: ${error.message}`);
    return;
  }

  const errors = [];
  requireString(manifest, 'name', errors);
  const version = requireString(manifest, 'version', errors);
  if (version && !semverPattern.test(version)) errors.push('version must be strict semver');
  requireString(manifest, 'description', errors);

  if (manifest.name && path.basename(pluginRoot) !== manifest.name) {
    errors.push(`plugin folder name (${path.basename(pluginRoot)}) should match plugin name (${manifest.name})`);
  }

  if (!manifest.author || typeof manifest.author !== 'object') {
    errors.push('author object is required');
  } else {
    requireString(manifest.author, 'name', errors, 'author');
  }

  if (!manifest.interface || typeof manifest.interface !== 'object') {
    errors.push('interface object is required');
  } else {
    for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
      requireString(manifest.interface, field, errors, 'interface');
    }
    if (!Array.isArray(manifest.interface.capabilities) || manifest.interface.capabilities.length === 0) {
      errors.push('interface.capabilities must be a non-empty array');
    }
    if (!manifest.interface.defaultPrompt && !manifest.interface.default_prompt) {
      errors.push('interface.defaultPrompt is required');
    }
  }

  if (typeof manifest.skills === 'string') validateRelativePath(pluginRoot, manifest.skills, errors, 'skills');
  if (typeof manifest.apps === 'string') validateRelativePath(pluginRoot, manifest.apps, errors, 'apps');
  if (typeof manifest.mcpServers === 'string') validateRelativePath(pluginRoot, manifest.mcpServers, errors, 'mcpServers');

  if (errors.length) fail('Plugin manifest', errors.join('\n'));
  else pass('Plugin manifest', path.relative(root, manifestPath));

  validateBundledSkills(pluginRoot);
  runOfficialPluginValidator(pluginRoot);
}

function requireString(object, key, errors, prefix = '') {
  const value = object[key];
  const field = prefix ? `${prefix}.${key}` : key;
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${field} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function validateRelativePath(pluginRoot, rawPath, errors, field) {
  const target = path.resolve(pluginRoot, rawPath);
  if (!target.startsWith(pluginRoot)) {
    errors.push(`${field} path must stay inside the plugin root`);
  } else if (!fs.existsSync(target)) {
    errors.push(`${field} path does not exist: ${rawPath}`);
  }
}

function runOfficialPluginValidator(pluginRoot) {
  const validator = path.join(pluginCreatorRoot, 'scripts/validate_plugin.py');
  if (!fs.existsSync(validator)) {
    warn('Official plugin validator', `Not found at ${validator}`);
    return;
  }
  if (!pythonHasYaml()) {
    warn('Official plugin validator', 'Skipped because Python module `yaml` is not installed.');
    return;
  }

  const result = spawnSync('python3', [validator, pluginRoot], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status === 0) pass('Official plugin validator', result.stdout.trim());
  else fail('Official plugin validator', [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n'));
}

function validateBundledSkills(pluginRoot) {
  const sourceRoot = path.join(root, '.agents/skills');
  const bundledRoot = path.join(pluginRoot, 'skills');

  for (const skillName of bundledSkillNames) {
    const sourceDir = path.join(sourceRoot, skillName);
    const bundledDir = path.join(bundledRoot, skillName);

    if (!fs.existsSync(sourceDir)) {
      fail(`Bundled skill ${skillName}`, `Missing source skill directory: ${path.relative(root, sourceDir)}`);
      continue;
    }
    if (!fs.existsSync(bundledDir)) {
      fail(`Bundled skill ${skillName}`, `Missing plugin copy: ${path.relative(root, bundledDir)}`);
      continue;
    }

    const mismatch = firstDirectoryMismatch(sourceDir, bundledDir);
    if (mismatch) {
      fail(`Bundled skill ${skillName}`, `Plugin copy is stale at ${mismatch}. Run pnpm plugin:sync.`);
    } else {
      pass(`Bundled skill ${skillName}`, 'Matches .agents/skills source.');
    }
  }
}

function firstDirectoryMismatch(sourceDir, targetDir) {
  const sourceFiles = listRelativeFiles(sourceDir);
  const targetFiles = listRelativeFiles(targetDir);
  if (sourceFiles.join('\n') !== targetFiles.join('\n')) {
    return 'file list';
  }

  for (const relativePath of sourceFiles) {
    const source = fs.readFileSync(path.join(sourceDir, relativePath));
    const target = fs.readFileSync(path.join(targetDir, relativePath));
    if (!source.equals(target)) return relativePath;
  }
  return undefined;
}

function listRelativeFiles(directory, base = directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listRelativeFiles(entryPath, base);
    return [path.relative(base, entryPath)];
  }).sort();
}

function validateSkills(skillRoot) {
  if (!fs.existsSync(skillRoot)) {
    fail('Skill root', `Missing skill root: ${path.relative(root, skillRoot)}`);
    return;
  }

  const skillFiles = fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(skillRoot, entry.name, 'SKILL.md'))
    .filter((file) => fs.existsSync(file))
    .sort();

  if (skillFiles.length === 0) {
    fail('Skills', `No SKILL.md files found under ${path.relative(root, skillRoot)}`);
    return;
  }

  for (const skillFile of skillFiles) {
    validateSkillFile(skillFile);
  }
}

function validateSkillFile(skillFile) {
  const relative = path.relative(root, skillFile);
  const content = fs.readFileSync(skillFile, 'utf8');
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)?.[1];
  const errors = [];

  if (!frontmatter) {
    fail(`Skill ${relative}`, 'Missing YAML frontmatter.');
    return;
  }

  const name = scalarFrontmatterValue(frontmatter, 'name');
  const description = descriptionFrontmatterValue(frontmatter);

  if (!name) errors.push('name is required');
  else if (!skillNamePattern.test(name)) errors.push(`name must be hyphen-case: ${name}`);
  if (!description) errors.push('description is required');
  else {
    if (description.length > 1024) errors.push(`description is too long (${description.length} > 1024)`);
    if (description.includes('<') || description.includes('>')) errors.push('description cannot contain angle brackets');
  }

  if (errors.length) fail(`Skill ${relative}`, errors.join('\n'));
  else pass(`Skill ${relative}`, name);

  runOfficialSkillValidator(path.dirname(skillFile));
}

function scalarFrontmatterValue(frontmatter, key) {
  const match = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(frontmatter);
  if (!match || match[1] === '>' || match[1] === '|') return undefined;
  return unquote(match[1].trim());
}

function descriptionFrontmatterValue(frontmatter) {
  const inline = /^description:\s*(.+?)\s*$/m.exec(frontmatter);
  if (!inline) return undefined;
  const value = inline[1].trim();
  if (value !== '>' && value !== '|') return unquote(value);

  const lines = frontmatter.split('\n');
  const start = lines.findIndex((line) => /^description:\s*[>|]\s*$/.test(line));
  const block = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) break;
    block.push(line.trim());
  }
  return block.join(' ').replace(/\s+/g, ' ').trim();
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function runOfficialSkillValidator(skillDir) {
  const validator = path.join(skillCreatorRoot, 'scripts/quick_validate.py');
  if (!fs.existsSync(validator)) return;
  if (!pythonHasYaml()) return;

  const result = spawnSync('python3', [validator, skillDir], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    fail(`Official skill validator ${path.relative(root, skillDir)}`, [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n'));
  }
}

function pythonHasYaml() {
  if (cachedPythonHasYaml !== undefined) return cachedPythonHasYaml;
  const result = spawnSync('python3', ['-c', 'import yaml'], { stdio: 'ignore' });
  cachedPythonHasYaml = result.status === 0;
  if (!cachedPythonHasYaml) {
    warn('Python yaml module', 'Missing PyYAML; built-in checks are running, official validators are skipped.');
  }
  return cachedPythonHasYaml;
}

function pass(label, detail) {
  results.push({ status: 'pass', label, detail });
}

function warn(label, detail) {
  results.push({ status: 'warn', label, detail });
}

function fail(label, detail) {
  results.push({ status: 'fail', label, detail });
}

function printSummary() {
  for (const result of results) {
    const marker = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`[${marker}] ${result.label}`);
    if (result.detail) {
      console.log(indent(result.detail));
    }
  }

  const counts = {
    pass: results.filter((result) => result.status === 'pass').length,
    warn: results.filter((result) => result.status === 'warn').length,
    fail: results.filter((result) => result.status === 'fail').length,
  };
  console.log(`\nSummary: ${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed.`);
}

function indent(value) {
  return String(value).split('\n').map((line) => `  ${line}`).join('\n');
}
