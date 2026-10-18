import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

it('executes the installed CLI through a package symlink as well as its direct path', async () => {
  const packageRoot = fileURLToPath(new URL('..', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'fliwright-bin-entrypoint-'));
  try {
    const scope = join(root, 'node_modules', '@fliwright');
    await mkdir(scope, { recursive: true });
    await symlink(packageRoot, join(scope, 'cli'), 'junction');
    for (const entry of [join(packageRoot, 'dist', 'index.js'), join(scope, 'cli', 'dist', 'index.js')]) {
      const { stdout, stderr } = await execFileAsync(process.execPath, [entry, 'schema', 'doctor', '--json'], {
        cwd: root,
        timeout: 10_000,
      });
      expect(stderr).toBe('');
      expect(stdout.trim(), `CLI entry ${entry} must emit its JSON result`).not.toBe('');
      expect(JSON.parse(stdout)).toMatchObject({ schemaVersion: 1, command: 'schema', ok: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
