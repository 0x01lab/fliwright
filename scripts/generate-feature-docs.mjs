#!/usr/bin/env node
// Source-derived implementation reference. Build the workspace before generating CLI schemas.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createRegistry } from '../packages/fliwright-cli/dist/index.js';
import { buildCommandReferences, commandFile, commandSummary } from './cli-command-docs.mjs';
const commandRegistry = createRegistry();
const commandReferences = await buildCommandReferences(commandRegistry);

const root = process.cwd();
const output = path.join(root, 'docs/features');
const date = new Date().toISOString().slice(0, 10);
const workspace = fs.readFileSync('pnpm-workspace.yaml', 'utf8');
if (!workspace.includes('packages/*')) throw new Error('Update package enumeration for the current workspace.');
const directories = fs.readdirSync('packages', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}`);
if (workspace.includes("'e2e'")) directories.push('e2e');
const exists = (file) => fs.existsSync(path.resolve(root, file));
function files(directory, suffix) {
  if (!exists(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file, suffix) : file.endsWith(suffix) ? [file] : [];
  }).sort();
}
const sources = directories.flatMap((directory) => files(`${directory}/src`, '.ts'));
const program = ts.createProgram(sources, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16, strict: true, skipLibCheck: true });
const checker = program.getTypeChecker();
const printer = ts.createPrinter();
const flags = ts.TypeFormatFlags.NoTruncation;
const packages = [], indexClasses = [], commands = [];
const pending = new Map();
function document(file, metadata, content) {
  pending.set(file, `---\n${Object.entries({ ...metadata, generated: date }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n\n${content.trim()}\n`);
}
function comment(node) {
  const symbol = node.name && checker.getSymbolAtLocation(node.name);
  return symbol ? ts.displayPartsToString(symbol.getDocumentationComment(checker)) : '';
}
function signature(node) {
  const sig = checker.getSignatureFromDeclaration(node);
  return sig ? checker.signatureToString(sig, node, flags) : '';
}
function description(node) {
  return (comment(node).split('\n')[0] || `Implemented in ${path.relative(root, node.getSourceFile().fileName)}.`).replaceAll('|', '\\|');
}
function publicMember(member) {
  return !member.modifiers?.some((modifier) => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(modifier.kind)) && !ts.isPrivateIdentifier(member.name ?? ts.factory.createIdentifier('_'));
}
function declaration(node) {
  if (ts.isClassDeclaration(node)) {
    const members = node.members.filter(publicMember).map((member) => {
      if (ts.isConstructorDeclaration(member)) return `constructor(${member.parameters.map((parameter) => parameter.getText()).join(', ')});`;
      if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) return `${member.name.getText()}${signature(member)};`;
      if (ts.isPropertyDeclaration(member)) return `${member.name.getText()}${member.questionToken ? '?' : ''}: ${member.type?.getText() ?? checker.typeToString(checker.getTypeAtLocation(member), member, flags)};`;
      return member.getText();
    });
    return `class ${node.name?.text ?? 'Anonymous'} {\n${members.map((line) => `  ${line}`).join('\n')}\n}`;
  }
  if (ts.isFunctionDeclaration(node)) return `function ${node.name?.text}${signature(node)};`;
  if (ts.isVariableDeclaration(node)) return `const ${node.name.getText()}: ${checker.typeToString(checker.getTypeAtLocation(node), node, flags)};`;
  return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
}
function emitSource(directory, slug, name, file, nodes, title = path.basename(file, '.ts')) {
  const doc = `${slug}/${title}.md`;
  const tests = files(`${directory}/tests`, '.test.ts').filter((test) => path.basename(test).toLowerCase().includes(title.toLowerCase())).map((file) => file);
  const units = nodes.map((node) => `## ${node.name?.getText() ?? title}\n\n${description(node)}\n\n\`\`\`typescript\n${declaration(node)}\n\`\`\``).join('\n\n');
  document(doc, { module: title, package: name, source: file, tests }, `# ${title}\n\n${units}\n\n## Related\n\n- [Package overview](./README.md)\n- Source: [${file}](/${path.resolve(file).slice(1)})`);
  return { title, doc: path.basename(doc), description: nodes[0] ? description(nodes[0]) : file };
}
for (const directory of directories) {
  const manifestFile = `${directory}/package.json`;
  if (!exists(manifestFile)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const slug = manifest.name.replace(/^@fliwright\//, '').replace(/^fliwright-/, '');
  const modules = [], types = [], groups = new Map();
  const entryFile = path.resolve(directory, 'src/index.ts');
  const entry = program.getSourceFile(entryFile);
  if (entry) {
    const module = checker.getSymbolAtLocation(entry);
    for (let symbol of module ? checker.getExportsOfModule(module) : []) {
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const node of symbol.declarations ?? []) {
        const file = path.relative(root, node.getSourceFile().fileName);
        if (!file.startsWith(`${directory}/src/`)) continue;
        if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) types.push(node);
        else if (ts.isClassDeclaration(node)) {
          const record = emitSource(directory, slug, manifest.name, file, [node], node.name.text);
          if (!modules.some((item) => item.doc === record.doc)) { modules.push(record); indexClasses.push({ ...record, slug, package: manifest.name }); }
        } else if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) {
          const nodes = groups.get(file) ?? []; if (!nodes.includes(node)) nodes.push(node); groups.set(file, nodes);
        }
      }
    }
  }
  // CLI commands/capabilities are an intentional additional public execution surface.
  if (manifest.bin) for (const file of [...files(`${directory}/src/commands`, '.ts'), ...files(`${directory}/src/capabilities`, '.ts'), `${directory}/src/config.ts`, `${directory}/src/reporter.ts`]) {
    const source = program.getSourceFile(path.resolve(file));
    if (!source) continue;
    const symbol = checker.getSymbolAtLocation(source);
    const nodes = (symbol ? checker.getExportsOfModule(symbol) : []).flatMap((symbol) => symbol.declarations ?? []);
    const functions = nodes.filter((node) => ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node));
    types.push(...nodes.filter((node) => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)));
    if (functions.length) groups.set(file, functions);
  }
  for (const [file, nodes] of groups) modules.push(emitSource(directory, slug, manifest.name, file, nodes));
  if (manifest.contributes) {
    document(`${slug}/contributions.md`, { module: 'contributions', package: manifest.name, source: manifestFile }, `# Editor contributions\n\nCommands, views and settings are derived from the extension manifest.\n\n\`\`\`json\n${JSON.stringify(manifest.contributes, null, 2)}\n\`\`\``);
    modules.push({ title: 'contributions', doc: 'contributions.md', description: 'VS Code commands, views and settings.' });
  }
  document(`${slug}/types.md`, { module: 'types', package: manifest.name, source: [...new Set(types.map((node) => path.relative(root, node.getSourceFile().fileName)))] }, `# Types and interfaces\n\n${[...new Set(types)].map((node) => `## ${node.name.getText()}\n\n${description(node)}\n\n\`\`\`typescript\n${declaration(node)}\n\`\`\``).join('\n\n') || 'This package exposes its execution surface through command schemas or manifest contributions.'}`);
  if (manifest.bin) {
    for (const [file, content] of commandReferences.pages) pending.set(`${slug}/${file === 'index.md' ? 'commands.md' : file}`, content.replaceAll('(./index.md)', '(./commands.md)').replace('\n---\n', `\ngenerated: ${JSON.stringify(date)}\n---\n`));
    for (const definition of commandRegistry.definitions.values()) {
      const file = commandFile(definition.path);
      const summary = commandSummary(definition.path);
      commands.push({ path: definition.path, description: summary, doc: `${slug}/${file}`, input: Object.keys(definition.input.shape).join(', ') });
      modules.push({ title: definition.path, doc: file, description: summary });
    }
    modules.unshift({ title: 'Command workflows', doc: 'commands.md', description: 'Task routing, practical examples and complete per-command guidance.' });
  }
  packages.push({ name: manifest.name, slug, description: manifest.description ?? directory, modules });
  document(`${slug}/README.md`, { package: manifest.name, version: manifest.version, layer: manifest.bin ? 'tooling' : manifest.contributes ? 'editor' : 'integration', status: 'implemented', source: manifestFile }, `# ${manifest.name}\n\n${manifest.description ?? directory}\n\n## Modules\n\n| Module | Responsibility | Reference |\n| --- | --- | --- |\n${modules.map((item) => `| ${item.title} | ${item.description} | [${item.doc}](./${item.doc}) |`).join('\n')}\n| types | Exported types and interfaces | [types.md](./types.md) |\n\n## Dependencies\n\n${Object.entries(manifest.dependencies ?? {}).map(([name, version]) => `- ${name}: ${version}`).join('\n') || 'No runtime package dependencies.'}\n\n## Entry points\n\n\`\`\`json\n${JSON.stringify(manifest.exports ?? manifest.bin ?? { main: manifest.main }, null, 2)}\n\`\`\``);
}
// Dart packages use their public barrels and registered extension modules as the source surface.
for (const directory of directories.filter((directory) => exists(`${directory}/pubspec.yaml`))) {
  const yaml = fs.readFileSync(`${directory}/pubspec.yaml`, 'utf8');
  const name = /^name:\s*(.+)$/m.exec(yaml)?.[1];
  const version = /^version:\s*(.+)$/m.exec(yaml)?.[1];
  const slug = name.replace(/^fliwright_/, '').replaceAll('_', '-');
  const publicFiles = files(`${directory}/lib`, '.dart').filter((file) => !file.includes('/src/'));
  const extensions = files(`${directory}/lib/src/extensions`, '.dart').filter((file) => /registry\.register\(/.test(fs.readFileSync(file, 'utf8')));
  const exportedFiles = publicFiles.flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/export\s+'([^']+)'/g)].map((match) => path.join(path.dirname(file), match[1]))).filter(exists);
  const targets = [...new Set([...publicFiles, ...extensions, ...exportedFiles])];
  const modules = targets.map((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const title = path.basename(file, '.dart');
    const methods = [...source.matchAll(/registry\.register\(\s*'([^']+)'/g)].map((match) => match[1]);
    document(`${slug}/${title}.md`, { module: title, package: name, source: file, extensions: methods }, `# ${title}\n\n${methods.length ? `VM Service methods: ${methods.join(', ')}.` : 'Public Dart package surface.'}\n\n## Implemented source contract\n\n\`\`\`dart\n${source}\n\`\`\`\n\n## Related\n\n[Package overview](./README.md)`);
    return { title, doc: `${title}.md`, description: methods.join(', ') || 'Public Dart API' };
  });
  packages.push({ name, slug, description: 'Flutter-side instrumentation and package APIs.', modules });
  document(`${slug}/README.md`, { package: name, version, layer: 'integration', source: `${directory}/pubspec.yaml`, status: 'implemented' }, `# ${name}\n\n## Modules\n\n| Module | API | Reference |\n| --- | --- | --- |\n${modules.map((item) => `| ${item.title} | ${item.description} | [${item.doc}](./${item.doc}) |`).join('\n')}\n\n## Package constraints\n\n\`\`\`yaml\n${yaml}\n\`\`\``);
}
const pipelines = [
  ['cli-workflow-pipeline', 'Skill, CLI and CI', ['packages/fliwright-cli/src/index.ts', 'packages/fliwright-cli/src/CommandRegistry.ts', 'packages/fliwright-cli/src/session/ConnectionHost.ts', 'packages/fliwright-cli/src/commands/run.ts', 'packages/fliwright-vitest/src/runner.ts', 'packages/fliwright-core/src/RunSession.ts'], 'The registry owns discovery and validation. Finite runs collect Vitest outcomes and canonical evidence. Connection workers retain reusable objects and serialize commands; they do not replace RunSession or its journals.'],
  ['recording-pipeline', 'Recording and generation', ['packages/fliwright-cli/src/commands/record.ts', 'packages/fliwright-core/src/RecordingCapture.ts', 'packages/fliwright-core/src/RecorderController.ts', 'packages/fliwright-core/src/EventAggregator.ts', 'packages/fliwright-cli/src/RecordingReplay.ts'], 'Capture owns start/stop and flushing. Code generation produces drafts; readiness and unchanged-candidate replay evidence determine whether tests may be published. The recording endpoint lease releases before replay forks start.'],
  ['self-healing-pipeline', 'Assertion and self-healing', ['packages/fliwright-core/src/Assertion.ts', 'packages/fliwright-core/src/SelfHealingEngine.ts', 'packages/fliwright-core/src/SnapshotStore.ts'], 'Assertions gather failure context and optional repair suggestions. Stable selectors belong in durable tests; screenshots, timelines and source context preserve failure evidence.'],
  ['form-fill-pipeline', 'Form autofill', ['packages/fliwright-core/src/FormHelper.ts', 'packages/fliwright-core/src/SemanticInferrer.ts', 'packages/fliwright-core/src/FakerGenerator.ts', 'packages/fliwright-core/src/SelectorResolver.ts'], 'Extract fields, infer semantics, resolve rules and generate values, then interact through locators.'],
  ['scenario-lease-pipeline', 'Scenarios and endpoint ownership', ['packages/fliwright-core/src/Scenario.ts', 'packages/fliwright-core/src/EndpointLease.ts', 'packages/fliwright-vitest/src/index.ts', 'packages/fliwright-tdd/src/runtime/TddRuntime.ts'], 'Fixtures acquire endpoint ownership and apply named composed scenarios before each attempt, including retries. TDD releases control-phase ownership before rerun forks acquire their leases.'],
  ['vm-service-endpoint-pipeline', 'VM Service endpoint acquisition', ['packages/fliwright-cli/src/vm-discovery.ts', 'packages/fliwright-core/src/VMServiceConnector.ts', 'packages/fliwright-tdd/src/daemon/FlutterDaemonEndpointSource.ts'], 'Explicit CLI inputs, project/environment configuration, discovery or managed Flutter launches resolve the endpoint. VM transport selects the runnable isolate; ref tokens belong to the app/isolate incarnation, so transport reconnect alone does not invalidate them.'],
];
for (const [file, title, trace, description] of pipelines) {
  for (const source of trace) if (!exists(source)) throw new Error(`Pipeline source moved: ${source}`);
  document(`${file}.md`, { feature: title, status: 'implemented', agent_accessible: true, source: trace }, `# ${title}\n\n${description}\n\n## Implementation trace\n\n${trace.map((source, index) => `${index + 1}. [${source}](/${path.resolve(source).slice(1)})`).join('\n')}\n\n## Agent access\n\nUse the current [CLI command reference](./cli/README.md) and project-local Skills. Preserve canonical run evidence for offline investigation.`);
}
document('index.md', { purpose: 'AI-agent-consumable feature index' }, `# Fliwright feature index\n\nGenerated from workspace package manifests, public source exports, command schemas, Dart barrels and VM extension registrations.\n\n## By Package\n\n| Package | Responsibility | Overview | Detailed Docs |\n| --- | --- | --- | --- |\n${packages.map((item) => `| ${item.name} | ${item.description} | [${item.slug}](./${item.slug}/README.md) | ${item.modules.length} modules |`).join('\n')}\n\n## By Class\n\n| Class | Package | Reference |\n| --- | --- | --- |\n${indexClasses.map((item) => `| ${item.title} | ${item.package} | [${item.title}](./${item.slug}/${item.doc}) |`).join('\n')}\n\n## By Feature Slice\n\n| Feature | Reference | Status |\n| --- | --- | --- |\n${pipelines.map(([file, title]) => `| ${title} | [Pipeline](./${file}.md) | Implemented |`).join('\n')}\n\n## CLI Command Quick Reference\n\n| Command | Input fields | Reference |\n| --- | --- | --- |\n${commands.map((item) => `| ${item.path} | ${item.input} | [Schema](./${item.doc}) |`).join('\n')}\n\n## Quick Start for AI Agents\n\n1. Discover exact command input with \`fliwright schema <path> --json\`.\n2. Inspect the app with \`app snapshot\`, \`app observe\` and \`app debug-snapshot\`.\n3. Run tests with \`run --scenario <name> --json\`; retain run artifacts and optional JUnit output in CI.\n4. Diagnose offline with \`artifacts failures\`, \`artifacts timeline\` and \`artifacts show\`.\n5. Generate or record drafts with \`generate-test\` and \`record --duration\`; inspect readiness before accepting tests.\n6. Open an explicit connection session for persistent TDD and close it when finished.\n7. Prepare app-owned state through named scenarios; use app-owned auth seeding for business tests.\n8. Use \`flow\` commands for runtime/Figma review and report generation.`);
// Prepare the entire output in memory before replacing the generated directory.
fs.rmSync(output, { recursive: true, force: true });
for (const [file, content] of pending) { const target = path.join(output, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
console.log(`Generated ${pending.size} implementation references for ${packages.length} packages and ${commands.length} CLI commands.`);
