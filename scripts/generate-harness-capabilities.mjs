#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checkOnly = process.argv.includes('--check');
const architecturePath = 'harness/architecture/dependency-rules.json';
const outputDirectory = 'harness/capabilities';
const packageOutputDirectory = `${outputDirectory}/packages`;

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function listFiles(relativeDirectory, extensions) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return listFiles(relativePath, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [relativePath] : [];
  }).sort();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function slugFor(name) {
  return name
    .replace(/^@fliwright\//, '')
    .replace(/_/g, '-')
    .replace(/^fliwright-/, '');
}

function titleFor(name) {
  return slugFor(name)
    .split('-')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function namedExports(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) return [];
  const source = readText(relativePath);
  const exports = [];

  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const item of match[1].split(',')) {
      const cleaned = item.replace(/\/\*.*?\*\//g, '').trim().replace(/^type\s+/, '');
      if (!cleaned) continue;
      const alias = /\s+as\s+([A-Za-z0-9_]+)/.exec(cleaned);
      exports.push(alias?.[1] ?? cleaned);
    }
  }

  for (const match of source.matchAll(/export\s+(?:abstract\s+)?(?:class|function|const|type|interface|enum)\s+([A-Za-z0-9_]+)/g)) {
    exports.push(match[1]);
  }

  return uniqueSorted(exports);
}

function dartPublicClasses(relativeDirectory) {
  return uniqueSorted(listFiles(relativeDirectory, ['.dart']).flatMap((relativePath) => (
    [...readText(relativePath).matchAll(/^class\s+([A-Z][A-Za-z0-9_]*)/gm)].map((match) => match[1])
  )));
}

function dartLibraryEntrypoints(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.dart'))
    .map((entry) => path.join(relativeDirectory, entry.name))
    .sort();
}

function packageEntrypoints(manifest) {
  const exports = manifest.exports;
  const packageEntrypoints = exports
    ? (typeof exports === 'string' ? ['.'] : Object.keys(exports))
    : (manifest.main ? ['.'] : []);
  const binaryEntrypoints = typeof manifest.bin === 'string'
    ? [manifest.name]
    : Object.keys(manifest.bin ?? {});
  return {
    packageEntrypoints: uniqueSorted(packageEntrypoints),
    binaryEntrypoints: uniqueSorted(binaryEntrypoints),
  };
}

function registeredMcpTools(sourceFiles) {
  const pattern = /\bserver\.tool\(\s*['"]([^'"]+)['"]/g;
  return uniqueSorted(sourceFiles.flatMap((relativePath) => (
    [...readText(relativePath).matchAll(pattern)].map((match) => match[1])
  )));
}

function registeredVmServiceMethods(sourceFiles) {
  const pattern = /\bregistry\.register\(\s*['"](ext\.fliwright\.[^'"]+)['"]/g;
  return uniqueSorted(sourceFiles.flatMap((relativePath) => (
    [...readText(relativePath).matchAll(pattern)].map((match) => match[1])
  )));
}

function sourceFingerprint(paths) {
  const hash = createHash('sha256');
  for (const relativePath of uniqueSorted(paths)) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readText(relativePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function vscodeContributions(relativePath) {
  const manifest = readJson(relativePath);
  const contributions = manifest.contributes ?? {};
  const commands = (contributions.commands ?? []).map((command) => command.command);
  const views = Object.values(contributions.views ?? {}).flat().map((view) => view.id);
  return {
    commands: uniqueSorted(commands),
    views: uniqueSorted(views),
  };
}

function typeScriptRecord(name, rule) {
  const manifestPath = rule.path === 'e2e' ? 'e2e/package.json' : `${rule.path}/package.json`;
  const manifest = readJson(manifestPath);
  const sourceDirectory = rule.path === 'e2e' ? rule.path : `${rule.path}/src`;
  const sourceFiles = listFiles(sourceDirectory, ['.ts', '.tsx']);
  const record = {
    name,
    path: rule.path,
    kind: rule.path === 'e2e' ? 'e2e' : 'typescript',
    responsibility: rule.responsibility,
    doesNotOwn: rule.doesNotOwn,
    mayDependOn: rule.mayDependOn,
    ownedCapabilities: rule.capabilities,
    sourceFiles,
    publicExports: namedExports(`${rule.path}/src/index.ts`),
    ...packageEntrypoints(manifest),
  };

  if (name === '@fliwright/mcp') {
    record.mcpToolModules = listFiles(`${rule.path}/src/tools`, ['.ts'])
      .map((file) => path.basename(file, '.ts'))
      .filter((name) => name !== 'index');
    record.mcpTools = registeredMcpTools(sourceFiles);
  }
  if (name === '@fliwright/cli') {
    record.cliCommands = listFiles(`${rule.path}/src/commands`, ['.ts'])
      .map((file) => path.basename(file, '.ts'));
    record.cliCapabilities = listFiles(`${rule.path}/src/capabilities`, ['.ts'])
      .map((file) => path.basename(file, '.ts'));
  }
  if (name === 'fliwright-vscode') {
    Object.assign(record, vscodeContributions(manifestPath));
  }

  record.sourceFingerprint = sourceFingerprint([architecturePath, manifestPath, ...sourceFiles]);
  return record;
}

function dartRecord(name, rule) {
  const manifestPath = `${rule.path}/pubspec.yaml`;
  const sourceFiles = listFiles(`${rule.path}/lib`, ['.dart']);
  const record = {
    name,
    path: rule.path,
    kind: 'dart',
    responsibility: rule.responsibility,
    doesNotOwn: rule.doesNotOwn,
    mayDependOn: rule.mayDependOn,
    ownedCapabilities: rule.capabilities,
    sourceFiles,
    publicClasses: dartPublicClasses(`${rule.path}/lib`),
    dartLibraryEntrypoints: dartLibraryEntrypoints(`${rule.path}/lib`),
  };

  if (name === 'fliwright_bridge') {
    record.bridgeExtensionModules = listFiles(`${rule.path}/lib/src/extensions`, ['.dart'])
      .map((file) => path.basename(file, '.dart'));
    record.vmServiceMethods = registeredVmServiceMethods(sourceFiles);
  }

  record.sourceFingerprint = sourceFingerprint([architecturePath, manifestPath, ...sourceFiles]);
  return record;
}

function markdownList(items) {
  return items.length ? items.map((item) => `- \`${item}\``).join('\n') : '- None';
}

function packageMarkdown(record) {
  const sections = [
    '---',
    `package: "${record.name}"`,
    `path: "${record.path}"`,
    `source_fingerprint: "${record.sourceFingerprint}"`,
    'generated: true',
    '---',
    '',
    `# ${titleFor(record.name)} Capabilities`,
    '',
    '## Responsibility',
    '',
    record.responsibility,
    '',
    '## Boundary',
    '',
    '### May Depend On',
    '',
    markdownList(record.mayDependOn),
    '',
    '### Must Not Own',
    '',
    markdownList(record.doesNotOwn),
    '',
    '## Owned Capabilities',
    '',
    markdownList(record.ownedCapabilities),
  ];

  const groups = [
    ['Package Entrypoints', record.packageEntrypoints],
    ['Binary Entrypoints', record.binaryEntrypoints],
    ['Public Exports', record.publicExports],
    ['MCP Tools', record.mcpTools],
    ['MCP Tool Modules', record.mcpToolModules],
    ['CLI Commands', record.cliCommands],
    ['CLI Capabilities', record.cliCapabilities],
    ['VS Code Commands', record.commands],
    ['VS Code Views', record.views],
    ['VM Service Methods', record.vmServiceMethods],
    ['Bridge Extension Modules', record.bridgeExtensionModules],
    ['Dart Library Entrypoints', record.dartLibraryEntrypoints],
    ['Public Dart Classes', record.publicClasses],
  ];

  for (const [heading, values] of groups) {
    if (!values?.length) continue;
    sections.push('', `## ${heading}`, '', markdownList(values));
  }

  sections.push('', '## Source Anchors', '', markdownList(record.sourceFiles), '');
  return sections.join('\n');
}

const architecture = readJson(architecturePath);
const packages = [
  ...Object.entries(architecture.typescriptPackages).map(([name, rule]) => typeScriptRecord(name, rule)),
  ...Object.entries(architecture.dartPackages).map(([name, rule]) => dartRecord(name, rule)),
].sort((left, right) => left.name.localeCompare(right.name));
const catalog = {
  schemaVersion: 1,
  source: 'derived from architecture rules and current source',
  packages,
};
const desiredFiles = new Map([
  [`${outputDirectory}/catalog.json`, `${JSON.stringify(catalog, null, 2)}\n`],
  ...packages.map((record) => [`${packageOutputDirectory}/${slugFor(record.name)}.md`, packageMarkdown(record)]),
]);

const failures = [];
for (const [relativePath, expected] of desiredFiles) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`Missing generated capability file ${relativePath}.`);
  } else if (readText(relativePath) !== expected) {
    failures.push(`Stale generated capability file ${relativePath}.`);
  }
}

if (fs.existsSync(path.join(root, packageOutputDirectory))) {
  for (const entry of fs.readdirSync(path.join(root, packageOutputDirectory))) {
    const relativePath = `${packageOutputDirectory}/${entry}`;
    if (!desiredFiles.has(relativePath)) failures.push(`Unexpected generated capability file ${relativePath}.`);
  }
}

if (checkOnly) {
  if (failures.length) {
    console.error('Harness capability catalog is stale:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('Harness capability catalog is current.');
  }
} else {
  fs.mkdirSync(path.join(root, packageOutputDirectory), { recursive: true });
  for (const [relativePath, content] of desiredFiles) {
    fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    fs.writeFileSync(path.join(root, relativePath), content);
  }
  for (const failure of failures.filter((failure) => failure.startsWith('Unexpected'))) {
    const relativePath = failure.match(/file (.+)\.$/)?.[1];
    if (relativePath) fs.rmSync(path.join(root, relativePath));
  }
  console.log(`Generated ${desiredFiles.size} Harness capability files.`);
}
