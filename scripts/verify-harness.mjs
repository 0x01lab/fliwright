#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function error(message) {
  errors.push(message);
}

function parseArgs(argv) {
  const options = { base: undefined, workingTree: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base') options.base = argv[index + 1];
    if (argv[index] === '--working-tree') options.workingTree = true;
  }
  return options;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function deepEqual(left, right) {
  return JSON.stringify(canonicalize(left ?? {})) === JSON.stringify(canonicalize(right ?? {}));
}

function packageDependencies(manifest) {
  return Object.entries({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  }).filter(([name]) => name.startsWith('@fliwright/') || name === 'fliwright-vscode');
}

function readPubspecSections(relativePath) {
  const lines = readText(relativePath).split('\n');
  const result = {};
  let section;
  let activeName;

  for (const line of lines) {
    const sectionMatch = /^(dependencies|dev_dependencies):\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      result[section] ??= {};
      activeName = undefined;
      continue;
    }

    if (/^\S/.test(line)) {
      section = undefined;
      activeName = undefined;
      continue;
    }

    if (!section) continue;

    const inlineDependency = /^  ([a-zA-Z0-9_]+):\s+(.+)\s*$/.exec(line);
    if (inlineDependency) {
      result[section][inlineDependency[1]] = inlineDependency[2].trim();
      activeName = undefined;
      continue;
    }

    const nestedDependency = /^  ([a-zA-Z0-9_]+):\s*$/.exec(line);
    if (nestedDependency) {
      activeName = nestedDependency[1];
      continue;
    }

    const nestedValue = /^    (sdk|path):\s+(.+)\s*$/.exec(line);
    if (nestedValue && activeName) {
      result[section][activeName] = `${nestedValue[1]}:${nestedValue[2].trim()}`;
    }
  }

  return result;
}

function listSourceFiles(directory) {
  const files = [];
  if (!fs.existsSync(directory)) return files;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(relativePath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }

  return files;
}

function workspaceImports(source) {
  const withoutTemplates = source.replace(/`(?:\\.|[^`])*`/gs, '');
  const withoutComments = withoutTemplates
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const imports = new Set();
  const dynamicImportPattern = /\bimport\(\s*['"](@fliwright\/[^/'"]+)/g;
  const staticDeclarationPattern = /^\s*(?:import|export)\b[\s\S]*?;/gm;
  const staticSpecifierPattern = /(?:from\s+)?['"](@fliwright\/[^/'"]+)['"]/;

  for (const declaration of withoutComments.matchAll(staticDeclarationPattern)) {
    const specifier = staticSpecifierPattern.exec(declaration[0]);
    if (specifier) imports.add(specifier[1]);
  }
  for (const match of withoutComments.matchAll(dynamicImportPattern)) imports.add(match[1]);
  return imports;
}

function changedFiles(base, includeWorkingTree = false) {
  try {
    const commands = [['diff', '--name-only', `${base}...HEAD`]];
    if (includeWorkingTree) {
      commands.push(
        ['diff', '--name-only'],
        ['diff', '--cached', '--name-only'],
        ['ls-files', '--others', '--exclude-standard'],
      );
    }
    return [...new Set(commands.flatMap((command) => (
      execFileSync('git', command, { cwd: root, encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean)
    )))];
  } catch (cause) {
    error(`Unable to read changes from ${base}: ${cause.message}`);
    return [];
  }
}

function sourceChange(relativePath) {
  return /^(packages\/[^/]+\/(src|lib)\/.+\.(ts|tsx|dart)|e2e\/.+\.ts|examples\/[^/]+\/lib\/.+\.dart)$/.test(relativePath);
}

function dependencyChange(relativePath) {
  return /(^|\/)(package\.json|pubspec\.yaml|tsconfig\.json)$/.test(relativePath);
}

function acceptedLedgerEntry(relativePath) {
  return /^harness\/memory\/ledger\/[^/]+\.md$/.test(relativePath)
    && !relativePath.endsWith('/README.md');
}

function ledgerChangedFiles(content) {
  const entry = /^- Changed-Files:\s*(.+)$/m.exec(content);
  if (!entry) return [];
  return [...entry[1].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function validateLedger() {
  const ledgerDirectory = path.join(root, 'harness/memory/ledger');
  const requiredFields = [
    '- Status: accepted',
    '- Date:',
    '- Scope:',
    '- Evidence:',
    '- Changed-Files:',
    '- Supersedes:',
    '## Decision',
  ];

  for (const entry of fs.readdirSync(ledgerDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;
    const content = fs.readFileSync(path.join(ledgerDirectory, entry.name), 'utf8');
    for (const field of requiredFields) {
      if (!content.includes(field)) error(`Ledger entry ${entry.name} is missing "${field}".`);
    }
  }
}

function childManifestPaths(directory, filename) {
  if (!fs.existsSync(path.join(root, directory))) return [];
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, directory, entry.name, filename)))
    .map((entry) => path.join(directory, entry.name, filename))
    .sort();
}

function dartRules(architecture) {
  return {
    ...architecture.dartPackages,
    ...(architecture.dartExamples ?? {}),
  };
}

function dartPackageName(relativePath) {
  return /^name:\s+(.+)$/m.exec(readText(relativePath))?.[1]?.trim();
}

function validateWorkspaceCoverage(stack, architecture) {
  const actualNodeManifests = [
    ...childManifestPaths('packages', 'package.json'),
    ...(fs.existsSync(path.join(root, 'e2e/package.json')) ? ['e2e/package.json'] : []),
  ].sort();
  const governedNodeManifests = Object.keys(stack.nodeDependencyManifests)
    .filter((relativePath) => relativePath !== 'package.json')
    .sort();

  if (!deepEqual(actualNodeManifests, governedNodeManifests)) {
    error('Harness stack does not cover the complete Node workspace manifest set.');
  }

  const actualNodeNames = actualNodeManifests
    .map((relativePath) => readJson(relativePath).name)
    .sort();
  const governedNodeNames = Object.keys(architecture.typescriptPackages).sort();
  if (!deepEqual(actualNodeNames, governedNodeNames)) {
    error('Harness architecture does not cover the complete Node workspace package set.');
  }

  const actualDartManifests = [
    ...childManifestPaths('packages', 'pubspec.yaml'),
    ...childManifestPaths('examples', 'pubspec.yaml'),
  ].sort();
  const governedDartManifests = Object.keys(stack.dartDependencyManifests).sort();
  if (!deepEqual(actualDartManifests, governedDartManifests)) {
    error('Harness stack does not cover the complete Dart workspace manifest set.');
  }

  const actualDartPackageNames = actualDartManifests
    .map(dartPackageName)
    .filter(Boolean)
    .sort();
  const governedDartPackageNames = Object.keys(dartRules(architecture)).sort();
  if (!deepEqual(actualDartPackageNames, governedDartPackageNames)) {
    error('Harness architecture does not cover the complete Dart package and example set.');
  }
}

function validateDependencyManifests(stack, architecture) {
  for (const [relativePath, expected] of Object.entries(stack.nodeDependencyManifests)) {
    const manifest = readJson(relativePath);
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'peerDependenciesMeta',
      'optionalDependencies',
      'bundleDependencies',
      'overrides',
      'pnpm',
      'engines',
    ]) {
      if (!deepEqual(manifest[field], expected[field])) {
        error(`${relativePath} ${field} differs from harness/stack/framework.json.`);
      }
    }

    if (!manifest.name || !architecture.typescriptPackages[manifest.name]) continue;
    const allowed = new Set(architecture.typescriptPackages[manifest.name].mayDependOn);
    for (const [dependency] of packageDependencies(manifest)) {
      if (!allowed.has(dependency)) {
        error(`${manifest.name} declares forbidden workspace dependency ${dependency}.`);
      }
    }
  }

  const governedDartRules = dartRules(architecture);
  for (const [relativePath, expected] of Object.entries(stack.dartDependencyManifests)) {
    const pubspec = readPubspecSections(relativePath);
    if (!deepEqual(pubspec.dependencies, expected.dependencies)
      || !deepEqual(pubspec.dev_dependencies, expected.dev_dependencies)) {
      error(`${relativePath} dependencies differ from harness/stack/framework.json.`);
    }

    const sdk = /^environment:\n(?:.+\n)*?  sdk:\s+(.+)$/m.exec(readText(relativePath));
    if (!sdk || sdk[1].trim() !== stack.dart.sdkConstraint) {
      error(`${relativePath} must use Dart SDK ${stack.dart.sdkConstraint}.`);
    }

    const packageName = dartPackageName(relativePath);
    const architectureRule = packageName ? governedDartRules[packageName] : undefined;
    if (!architectureRule) {
      error(`${relativePath} has no Dart architecture rule.`);
      continue;
    }
    const allowed = new Set(architectureRule.mayDependOn);
    for (const dependency of Object.keys(pubspec.dependencies ?? {})) {
      if (!governedDartRules[dependency] || allowed.has(dependency)) continue;
      error(`${packageName} declares forbidden Dart workspace dependency ${dependency}.`);
    }
  }
}

function validateTypeScript(stack) {
  const tsconfigs = [
    'e2e/tsconfig.json',
    ...Object.values(readJson('harness/architecture/dependency-rules.json').typescriptPackages)
      .map((packageRule) => `${packageRule.path}/tsconfig.json`)
      .filter((relativePath) => relativePath !== 'e2e/tsconfig.json'),
  ];

  for (const relativePath of new Set(tsconfigs)) {
    if (!fs.existsSync(path.join(root, relativePath))) continue;
    const compilerOptions = readJson(relativePath).compilerOptions ?? {};
    for (const [key, expected] of Object.entries(stack.node.requiredTypeScriptOptions)) {
      if (compilerOptions[key] !== expected) {
        error(`${relativePath} compilerOptions.${key} must be ${JSON.stringify(expected)}.`);
      }
    }
  }
}

function validateImportBoundaries(architecture, stack) {
  for (const [packageName, rule] of Object.entries(architecture.typescriptPackages)) {
    const manifestPath = rule.path === 'e2e'
      ? 'e2e/package.json'
      : `${rule.path}/package.json`;
    const manifest = readJson(manifestPath);
    const declared = new Set(packageDependencies(manifest).map(([name]) => name));
    const allowed = new Set(rule.mayDependOn);
    const sourceDirectories = packageName === '@fliwright/e2e-tests'
      ? [path.join(root, rule.path)]
      : [path.join(root, rule.path, 'src'), path.join(root, rule.path, 'tests')];

    for (const sourceDirectory of sourceDirectories) {
      for (const file of listSourceFiles(sourceDirectory)) {
        const relativePath = path.relative(root, file);
        for (const dependency of workspaceImports(fs.readFileSync(file, 'utf8'))) {
          if (dependency === packageName) continue;
          if (!allowed.has(dependency)) {
            error(`${relativePath} imports ${dependency}, outside ${packageName}'s capability boundary.`);
          }
          if (!declared.has(dependency)) {
            error(`${relativePath} imports ${dependency}, but ${manifestPath} does not declare it.`);
          }
        }
      }
    }
  }
}

function validateWorkspaceLock(stack) {
  const rootManifest = readJson('package.json');
  if (rootManifest.packageManager !== stack.node.packageManager) {
    error(`package.json packageManager must be ${stack.node.packageManager}.`);
  }
  if (!fs.existsSync(path.join(root, stack.node.lockfile))) {
    error(`Missing required workspace lockfile ${stack.node.lockfile}.`);
  }

  for (const packageDirectory of fs.readdirSync(path.join(root, 'packages'), { withFileTypes: true })) {
    if (!packageDirectory.isDirectory()) continue;
    const lockPath = path.join(root, 'packages', packageDirectory.name, 'package-lock.json');
    if (fs.existsSync(lockPath)) error(`Remove stray npm lockfile ${path.relative(root, lockPath)}; pnpm-lock.yaml is authoritative.`);
  }
}

function validateCapabilityCatalog() {
  try {
    execFileSync(process.execPath, ['scripts/generate-harness-capabilities.mjs', '--check'], {
      cwd: root,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (cause) {
    const output = [cause.stdout, cause.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    error(output || 'Harness capability catalog is stale.');
  }
}

function validateLearningEvidence(base, includeWorkingTree) {
  if (!base) return;
  const changed = changedFiles(base, includeWorkingTree);
  const learningFiles = changed.filter((file) => sourceChange(file) || dependencyChange(file));
  if (!learningFiles.length) return;

  const entries = changed.filter(acceptedLedgerEntry);
  if (!entries.length) {
    error(`Changes since ${base} alter source or dependency manifests but include no accepted Harness ledger entry.`);
    return;
  }

  const evidencedFiles = new Set(entries.flatMap((relativePath) => (
    ledgerChangedFiles(readText(relativePath))
  )));
  const missingEvidence = learningFiles.filter((relativePath) => !evidencedFiles.has(relativePath));
  if (missingEvidence.length) {
    error(`Accepted Harness ledger entries do not evidence: ${missingEvidence.join(', ')}.`);
  }
}

const options = parseArgs(process.argv.slice(2));
const stack = readJson('harness/stack/framework.json');
const architecture = readJson('harness/architecture/dependency-rules.json');

validateWorkspaceLock(stack);
validateWorkspaceCoverage(stack, architecture);
validateDependencyManifests(stack, architecture);
validateTypeScript(stack);
validateImportBoundaries(architecture, stack);
validateLedger();
validateCapabilityCatalog();
validateLearningEvidence(options.base, options.workingTree);

if (errors.length) {
  console.error('Harness validation failed:');
  for (const message of errors) console.error(`- ${message}`);
  process.exitCode = 1;
} else {
  console.log('Harness validation passed.');
}
