import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initCommand } from '../src/commands/init.js';
import { executeCli } from '../src/index.js';

describe('one-command Codex setup', () => {
  let project: string;
  let skillsRoot: string;
  const silent = { log: () => {} };

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'fliwright-init-agent-'));
    skillsRoot = await mkdtemp(join(tmpdir(), 'fliwright-skills-'));
    await mkdir(join(project, 'lib'));
    await writeFile(join(project, 'pubspec.yaml'), 'name: sample_app\n');
    await writeFile(join(project, 'lib/main.dart'), 'void main() {}\n');
    for (const name of ['fliwright-cli-workflows', 'fliwright-agent-memory', 'write-fliwright-tests', 'write-fliwright-mock-rules']) {
      await mkdir(join(skillsRoot, name, 'references'), { recursive: true });
      const skillBody = name === 'fliwright-agent-memory' ? 'Memory belongs to the Flutter project at `.fliwright/memory/`.\n' : '';
      await writeFile(join(skillsRoot, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Test\n---\n${skillBody}`);
      await writeFile(join(skillsRoot, name, 'references/guide.md'), 'bundled reference v1\n');
    }
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
    await rm(skillsRoot, { recursive: true, force: true });
  });

  it('installs complete Skills and appends Agent instructions while preserving project rules', async () => {
    await writeFile(join(project, 'AGENTS.md'), '# Team rules\n\nKeep these instructions.\n');
    const result = await initCommand(project, { agent: 'codex', yes: true, install: false }, { ...silent, skillsRoot });
    expect(await readFile(join(project, '.agents/skills/fliwright-cli-workflows/references/guide.md'), 'utf8')).toBe('bundled reference v1\n');
    expect(await readFile(join(project, '.agents/skills/fliwright-agent-memory/SKILL.md'), 'utf8')).toContain('project at `.fliwright/memory/`');
    expect(await readFile(join(project, '.agents/skills/fliwright-agent-memory/references/guide.md'), 'utf8')).toBe('bundled reference v1\n');
    const agents = await readFile(join(project, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('# Team rules\n\nKeep these instructions.');
    expect(agents).toContain('<!-- fliwright:start -->');
    expect(agents).toContain('auth.seedLoggedIn');
    expect(result.agent?.skills).toHaveLength(4);
    expect(agents).toContain('fliwright-agent-memory');
    expect(result.status).toBe('needs-attention');
    expect(result.runtimeVerified).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ name: 'dependencies', status: 'pending' }));
  });

  it('updates only unmodified managed resources and reports locally edited files', async () => {
    const options = { agent: 'codex' as const, install: false };
    await initCommand(project, options, { ...silent, skillsRoot });
    const agentPath = join(project, 'AGENTS.md');
    const initialAgents = await readFile(agentPath, 'utf8');
    await writeFile(agentPath, `# Custom prefix\n${initialAgents}\nCustom suffix\n`);
    const resource = join(project, '.agents/skills/fliwright-cli-workflows/references/guide.md');
    await writeFile(join(skillsRoot, 'fliwright-cli-workflows/references/guide.md'), 'bundled reference v2\n');
    await initCommand(project, options, { ...silent, skillsRoot });
    expect(await readFile(resource, 'utf8')).toBe('bundled reference v2\n');
    await writeFile(resource, 'local customization\n');
    const result = await initCommand(project, options, { ...silent, skillsRoot });
    expect(await readFile(resource, 'utf8')).toBe('local customization\n');
    expect(result.agent?.conflicts).toContain('.agents/skills/fliwright-cli-workflows/references/guide.md');
    expect(result.status).toBe('needs-attention');
    const agents = await readFile(agentPath, 'utf8');
    expect(agents.match(/<!-- fliwright:start -->/g)).toHaveLength(1);
    expect(agents).toContain('# Custom prefix');
    expect(agents).toContain('Custom suffix');
  });

  it('preserves unmanaged same-name Skills instead of mixing in bundled files', async () => {
    await mkdir(join(project, '.agents/skills/fliwright-cli-workflows'), { recursive: true });
    await writeFile(join(project, '.agents/skills/fliwright-cli-workflows/SKILL.md'), 'custom skill');
    const result = await initCommand(project, { agent: 'codex', install: false }, { ...silent, skillsRoot });
    expect(await readFile(join(project, '.agents/skills/fliwright-cli-workflows/SKILL.md'), 'utf8')).toBe('custom skill');
    expect(result.agent?.conflicts).toContain('.agents/skills/fliwright-cli-workflows');
    await expect(readFile(join(project, '.agents/skills/fliwright-cli-workflows/references/guide.md'))).rejects.toThrow();
  });

  it('rejects a missing app entrypoint before generating any scaffold', async () => {
    await rm(join(project, 'lib/main.dart'));
    await expect(initCommand(project, { agent: 'codex', install: false }, { ...silent, skillsRoot })).rejects.toThrow(/entrypoint/i);
    await expect(readFile(join(project, 'fliwright.config.ts'))).rejects.toThrow();
  });

  it('rejects malformed Agent markers before changing the project', async () => {
    await writeFile(join(project, 'AGENTS.md'), '# Team rules\n<!-- fliwright:start -->\n');
    await expect(initCommand(project, { agent: 'codex', install: false }, { ...silent, skillsRoot })).rejects.toThrow(/markers/);
    await expect(readFile(join(project, 'fliwright.config.ts'))).rejects.toThrow();
  });

  it('preserves resources behind symlinks when updating managed Skills', async () => {
    const options = { agent: 'codex' as const, install: false };
    await initCommand(project, options, { ...silent, skillsRoot });
    const target = join(project, '.agents/skills/fliwright-cli-workflows/references/guide.md');
    const outside = join(project, 'outside.md');
    await writeFile(outside, 'outside content');
    await rm(target);
    await symlink(outside, target);
    const result = await initCommand(project, options, { ...silent, skillsRoot });
    expect(await readFile(outside, 'utf8')).toBe('outside content');
    expect(result.agent?.conflicts).toContain('.agents/skills/fliwright-cli-workflows/references/guide.md');
  });

  it('rejects missing packaged references before generating scaffold files', async () => {
    await rm(join(skillsRoot, 'write-fliwright-tests'), { recursive: true });
    await expect(initCommand(project, { agent: 'codex', install: false }, { ...silent, skillsRoot })).rejects.toThrow(/missing bundled Skill/);
    await expect(readFile(join(project, 'fliwright.config.ts'))).rejects.toThrow();
  });

  it('supports an explicit flavor entrypoint and flags an existing Vitest config for review', async () => {
    await writeFile(join(project, 'lib/main_dev.dart'), 'void main() {}\n');
    await writeFile(join(project, 'vitest.config.ts'), 'export default {};\n');
    const result = await initCommand(project, { agent: 'codex', entrypoint: 'lib/main_dev.dart', install: false }, { ...silent, skillsRoot });
    expect(await readFile(join(project, 'test_driver/fliwright_app.dart'), 'utf8')).toContain('package:sample_app/main_dev.dart');
    expect(await readFile(join(project, 'vitest.config.ts'), 'utf8')).toBe('export default {};\n');
    expect(result.checks).toContainEqual(expect.objectContaining({ name: 'vitest', status: 'pending' }));
  });

  it('does not shadow an existing JavaScript Vitest configuration with a new TypeScript file', async () => {
    await writeFile(join(project, 'vitest.config.mjs'), 'export default {};\n');
    const result = await initCommand(project, { agent: 'codex', install: false }, { ...silent, skillsRoot });
    await expect(readFile(join(project, 'vitest.config.ts'))).rejects.toThrow();
    expect(await readFile(join(project, 'vitest.config.mjs'), 'utf8')).toBe('export default {};\n');
    expect(result.checks).toContainEqual(expect.objectContaining({ name: 'vitest', status: 'pending', message: expect.stringContaining('vitest.config.mjs') }));
  });

  it('reports incompatible existing Node configuration without replacing it', async () => {
    await writeFile(join(project, 'package.json'), JSON.stringify({ type: 'commonjs', devDependencies: { vitest: '^9.0.0' } }));
    const result = await initCommand(project, { agent: 'codex' }, { ...silent, skillsRoot, runCommand: async () => {} });
    expect(result.status).toBe('needs-attention');
    expect(result.checks).toContainEqual(expect.objectContaining({ name: 'node-config', status: 'pending' }));
    const pkg = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
    expect(pkg.type).toBe('commonjs');
    expect(pkg.devDependencies.vitest).toBe('^9.0.0');
  });

  it('retains partial progress and provides an actionable failure when installation fails', async () => {
    await expect(initCommand(project, { agent: 'codex' }, {
      ...silent, skillsRoot,
      runCommand: async () => { throw new Error('registry unavailable'); },
    })).rejects.toMatchObject({
      code: 'INIT_INSTALL_FAILED', exitCode: 3,
      data: expect.objectContaining({ status: 'needs-attention', runtimeVerified: false, created: expect.any(Array) }),
    });
  });

  it('does not report runtime verification when all setup commands succeed', async () => {
    const commands: string[][] = [];
    const result = await initCommand(project, { agent: 'codex', yes: true }, {
      ...silent, skillsRoot, runCommand: async (command, args) => { commands.push([command, ...args]); },
    });
    expect(result.status).toBe('configured');
    expect(result.runtimeVerified).toBe(false);
    expect(commands.some(([command]) => command === 'codex')).toBe(false);
    expect(commands).toContainEqual(['flutter', 'pub', 'add', 'fliwright_bridge']);
    expect(result.nextSteps.join('\n')).toContain('doctor');
  });

  it('accepts the noninteractive agent flags through the JSON CLI contract', async () => {
    const result = await executeCli(['init', '--agent', 'codex', '--yes', '--install', 'false', '--cwd', project, '--json']);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.agent.skills).toContain('fliwright-cli-workflows');
    expect(envelope.data.agent.skills).toContain('fliwright-agent-memory');
    expect(envelope.data.runtimeVerified).toBe(false);
  });
});
