#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function changedFiles(base) {
  const commands = [
    ['diff', '--name-only', `${base}...HEAD`],
    ['diff', '--name-only'],
    ['diff', '--cached', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ];
  return [...new Set(commands.flatMap((command) => (
    execFileSync('git', command, { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
  )))];
}

const base = option('--base');
const requestedSlug = option('--slug');

if (!base) {
  console.error('Usage: node scripts/capture-harness-memory.mjs --base <git-ref> --slug <short-topic>');
  process.exit(1);
}

const changed = changedFiles(base);
const sourceFiles = changed.filter((file) => /^(packages\/[^/]+\/(src|lib)\/.+\.(ts|tsx|dart)|e2e\/.+\.ts|examples\/[^/]+\/lib\/.+\.dart)$/.test(file));
const manifests = changed.filter((file) => /(^|\/)(package\.json|pubspec\.yaml|tsconfig\.json)$/.test(file));

if (!sourceFiles.length && !manifests.length) {
  console.log(`No source or dependency changes found since ${base}; no learning draft created.`);
  process.exit(0);
}

const slug = (requestedSlug ?? 'change')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'change';
const date = new Date().toISOString().slice(0, 10);
const filename = `${date}-${slug}.md`;
const relativePath = path.join('harness/memory/ledger/drafts', filename);
const destination = path.join(root, relativePath);

if (fs.existsSync(destination)) {
  console.error(`Draft already exists: ${relativePath}`);
  process.exit(1);
}

const list = (files) => files.map((file) => `- \`${file}\``).join('\n') || '- none';
const content = `# Learning Draft: ${slug}

- Status: draft
- Date: ${date}
- Base: ${base}
- Scope: determine during review
- Changed-Files: ${[...sourceFiles, ...manifests].map((file) => `\`${file}\``).join(', ') || 'none'}

## Automatically Collected Evidence

### Source Changes

${list(sourceFiles)}

### Dependency Or Framework Changes

${list(manifests)}

## Proposed Decision

Describe only the verified, reusable lesson. Promote this file to
\`harness/memory/ledger/\` after setting \`Status: accepted\`, adding Scope,
Evidence, Supersedes, and a \`## Decision\` section that satisfies the ledger
schema.
`;

fs.writeFileSync(destination, content);
console.log(`Created learning draft: ${relativePath}`);
