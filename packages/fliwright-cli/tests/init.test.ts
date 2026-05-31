import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('initCommand', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-init-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates fliwright.config.ts', async () => {
    await initCommand(tmpDir);
    const content = await readFile(join(tmpDir, 'fliwright.config.ts'), 'utf8');
    expect(content).toContain('defineConfig');
  });

  it('creates example test file in tests/ directory', async () => {
    await initCommand(tmpDir);
    const content = await readFile(join(tmpDir, 'tests', 'example.test.ts'), 'utf8');
    expect(content).toContain('test(');
  });

  it('does not overwrite existing fliwright.config.ts', async () => {
    await writeFile(join(tmpDir, 'fliwright.config.ts'), 'existing');
    await initCommand(tmpDir);
    const content = await readFile(join(tmpDir, 'fliwright.config.ts'), 'utf8');
    expect(content).toBe('existing');
  });
});
