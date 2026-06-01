import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseArgs,
  runSetup,
  setupClaudeCode,
  setupCodex,
  validateTargetDir,
} from '../src/setup.js';

describe('fliwright-ai-setup', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-ai-plugin-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects directories that do not look like a project root', () => {
    expect(() => validateTargetDir(tmpDir)).toThrow('does not appear to be a project root');
  });

  it('installs Codex instructions into AGENTS.md with managed markers', async () => {
    await writeFile(join(tmpDir, 'package.json'), '{}');

    runSetup(parseArgs(['codex', '--target', tmpDir]));

    const content = await readFile(join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('<!-- FLIWRIGHT-PLUGIN-START -->');
    expect(content).toContain('Fliwright Testing Assistant');
    expect(content).toContain('<!-- FLIWRIGHT-PLUGIN-END -->');
  });

  it('replaces only the managed Codex block on reinstall', async () => {
    await writeFile(join(tmpDir, 'package.json'), '{}');
    await writeFile(
      join(tmpDir, 'AGENTS.md'),
      [
        '# Project Rules',
        '<!-- FLIWRIGHT-PLUGIN-START -->',
        'old managed content',
        '<!-- FLIWRIGHT-PLUGIN-END -->',
        'keep this',
      ].join('\n'),
    );

    setupCodex(tmpDir);

    const content = await readFile(join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('# Project Rules');
    expect(content).toContain('keep this');
    expect(content).toContain('Fliwright Testing Assistant');
    expect(content).not.toContain('old managed content');
  });

  it('refuses to repair orphaned Codex markers automatically', async () => {
    await writeFile(join(tmpDir, 'AGENTS.md'), '<!-- FLIWRIGHT-PLUGIN-START -->\n');

    expect(() => setupCodex(tmpDir)).toThrow('Orphaned FLIWRIGHT marker');
  });

  it('does not overwrite an existing Claude Code skill unless forced', async () => {
    const skillDir = join(tmpDir, '.claude', 'skills', 'fliwright');
    const skillPath = join(skillDir, 'SKILL.md');
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, 'custom skill');

    expect(() => setupClaudeCode(tmpDir)).toThrow('already exists');
    await expect(readFile(skillPath, 'utf8')).resolves.toBe('custom skill');
  });

  it('overwrites an existing Claude Code skill when forced', async () => {
    const skillDir = join(tmpDir, '.claude', 'skills', 'fliwright');
    const skillPath = join(skillDir, 'SKILL.md');
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillPath, 'custom skill');

    setupClaudeCode(tmpDir, { force: true });

    const content = await readFile(skillPath, 'utf8');
    expect(content).toContain('Fliwright Testing Assistant');
    expect(content).not.toBe('custom skill');
  });

  it('parses target and force options', () => {
    const parsed = parseArgs(['--all', '--target', 'app', '--force'], tmpDir);

    expect(parsed.platform).toBe('all');
    expect(parsed.targetDir).toBe(join(tmpDir, 'app'));
    expect(parsed.force).toBe(true);
  });

  it('does not run the CLI main function when imported by tests', () => {
    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(false);
  });
});
