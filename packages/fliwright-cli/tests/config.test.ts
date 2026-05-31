import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, defineConfig, type FliwrightCliConfig } from '../src/config.js';

describe('defineConfig', () => {
  it('fills defaults for omitted optional fields', () => {
    const config = defineConfig({});
    expect(config.timeout).toBe(30000);
    expect(config.screenshot).toBe('file');
    expect(config.testDir).toBe('tests');
    expect(config.reporter).toBe('pretty');
    expect(config.vmServiceUrl).toBeUndefined();
  });

  it('preserves explicit values', () => {
    const config = defineConfig({
      vmServiceUrl: 'ws://localhost:8181/ws',
      timeout: 60000,
      testDir: 'e2e',
    });
    expect(config.vmServiceUrl).toBe('ws://localhost:8181/ws');
    expect(config.timeout).toBe(60000);
    expect(config.testDir).toBe('e2e');
    expect(config.screenshot).toBe('file');
  });
});

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'fliwright-cli-config-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig(tmpDir);
    expect(config.testDir).toBe('tests');
    expect(config.reporter).toBe('pretty');
    expect(config.timeout).toBe(30000);
  });

  it('loads values from fliwright.config.ts', async () => {
    await writeFile(join(tmpDir, 'fliwright.config.ts'), [
      "const defineConfig = (o) => o;",
      'export default defineConfig({',
      "  testDir: 'e2e',",
      '  timeout: 60000,',
      '});',
    ].join('\n'));

    const config = await loadConfig(tmpDir);
    expect(config.testDir).toBe('e2e');
    expect(config.timeout).toBe(60000);
  });
});
