import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const exec = promisify(execFile);

it.skipIf(process.platform === 'win32')('bootstraps a clean project using only the packed CLI resources and emits one JSON document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fliwright-packed-init-'));
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  try {
    await exec('pnpm', ['pack', '--pack-destination', root], { cwd: packageRoot });
    const tarball = (await readdir(root)).find((entry) => entry.endsWith('.tgz'))!;
    await exec('tar', ['-xzf', join(root, tarball), '-C', root]);
    const packed = join(root, 'package');
    // Supply runtime dependencies without supplying any source Skill directories.
    await symlink(join(packageRoot, 'node_modules'), join(packed, 'node_modules'), 'junction');
    const project = join(root, 'consumer');
    await mkdir(join(project, 'lib'), { recursive: true });
    await writeFile(join(project, 'pubspec.yaml'), 'name: packed_consumer\n');
    await writeFile(join(project, 'lib/main.dart'), 'void main() {}\n');
    const bin = join(root, 'bin');
    await mkdir(bin);
    // Exercise stdout emitted by installers without accessing registries or Flutter.
    for (const name of ['npm', 'flutter']) {
      await writeFile(join(bin, name), `#!${process.execPath}\nconsole.log('installer stdout');\nconsole.error('installer stderr');\n`);
      await chmod(join(bin, name), 0o755);
    }
    const { stdout, stderr } = await exec(process.execPath, [join(packed, 'dist/index.js'), 'init', '--agent', 'codex', '--yes', '--pm', 'npm', '--json'], {
      cwd: project, env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` },
    });
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, data: { status: 'configured', runtimeVerified: false } });
    expect(stderr).toContain('installer stdout');
    expect(stderr).toContain('installer stderr');
    const skill = await readFile(join(project, '.agents/skills/fliwright-cli-workflows/SKILL.md'), 'utf8');
    expect(skill).toContain('name: fliwright-cli-workflows');
    const memorySkill = await readFile(join(packageRoot, 'dist/skills/fliwright-agent-memory/SKILL.md'), 'utf8');
    expect(memorySkill).toContain('name: fliwright-agent-memory');
    const reference = await readFile(join(project, '.agents/skills/fliwright-cli-workflows/references/commands/command-init.md'), 'utf8');
    expect(reference).toContain('--agent');
    expect(await readFile(join(project, 'AGENTS.md'), 'utf8')).toContain('fliwright:start');
    const repeated = await exec(process.execPath, [join(packed, 'dist/index.js'), 'init', '--agent', 'codex', '--yes', '--install', 'false', '--json'], { cwd: project });
    expect(JSON.parse(repeated.stdout).data.agent.conflicts).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
