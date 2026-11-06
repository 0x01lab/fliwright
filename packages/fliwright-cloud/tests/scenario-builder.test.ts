import { expect, it } from 'vitest';
import { transpileModule, ModuleKind } from 'typescript';
import { mergeFliwrightConfig, ScenarioResolver } from '@fliwright/core';
import { scenarioFiles, type ScenarioDraft } from '../src/web/scenario-builder.js';
import type { TestCatalog } from '@fliwright/cloud-protocol';
import { loadConfig } from '@fliwright/cli';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const catalog = {
  scenarios: [{ name: 'existing', fingerprint: 'a'.repeat(64) }],
  mocks: [{ directory: '.fliwright/mocks', profiles: ['empty', 'member', 'success'], endpoints: [
    { endpoint: '/user', method: 'GET', rules: ['success', 'member'], activeRule: 'success' },
    { endpoint: '/user', method: 'POST', rules: ['success', 'empty'], activeRule: 'success' },
  ] }],
} as TestCatalog;
const draft: ScenarioDraft = {
  name: 'member-empty', profile: 'member', route: '/assets',
  directory: '.fliwright/mocks', allowUnmatched: false,
  rules: [{ endpoint: '/user', method: 'GET', rule: 'member' }, { endpoint: '/user', method: 'POST', rule: 'empty' }],
};

it('generates executable TypeScript accepted by the actual configuration schema and resolver', async () => {
  const result = scenarioFiles(draft, catalog);
  const javascript = transpileModule(result.source, { compilerOptions: { module: ModuleKind.ESNext } }).outputText;
  const { scenarios } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
  const config = mergeFliwrightConfig({ project: { scenarios } });
  const scenario = new ScenarioResolver(config.scenarios!).resolve('member-empty');
  expect(scenario.layers).toEqual([
    { kind: 'mocks', directory: draft.directory, denyUnmatchedRequests: true, profile: 'member', rules: draft.rules },
    { kind: 'navigation', route: '/assets' },
  ]);
  expect(result.filename).toBe('member-empty.ts');
  expect(result.integration).toContain("'./.fliwright/scenarios/member-empty.js'");
  expect(result.integration).toContain('...generatedScenarios');
  const root = await mkdtemp(join(tmpdir(), 'cloud-scenario-config-'));
  try {
    await mkdir(join(root, '.fliwright/scenarios'), { recursive: true });
    await writeFile(join(root, '.fliwright/scenarios', result.filename), result.source);
    await writeFile(join(root, 'fliwright.config.ts'), `import { defineConfig } from ${JSON.stringify(import.meta.resolve('@fliwright/cli'))};\nimport { scenarios as generatedScenarios } from './.fliwright/scenarios/member-empty.js';\nexport default defineConfig({ timeout: 45000, scenarios: { existing: { name: 'existing', layers: [] }, ...generatedScenarios } });`);
    const loaded = await loadConfig(root);
    expect(loaded.timeout).toBe(45000);
    expect(Object.keys(loaded.scenarios!)).toEqual(['existing', 'member-empty']);
    expect(new ScenarioResolver(loaded.scenarios!).resolve('member-empty')).toEqual(scenario);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('rejects invalid paths, duplicate names, and stale or duplicate mock selections', () => {
  for (const change of [
    { name: '' }, { name: '../escape' }, { name: 'existing' }, { route: 'assets' },
    { directory: '../mocks' }, { profile: 'missing' }, { rules: [{ endpoint: '/user', method: 'GET', rule: 'missing' }] },
    { rules: [draft.rules[0]!, draft.rules[0]!] },
  ]) expect(() => scenarioFiles({ ...draft, ...change }, catalog)).toThrow();
});

it('supports projects without discovered mocks and omits unspecified state', () => {
  const result = scenarioFiles({ name: '由测试准备', profile: '', route: '', directory: '', rules: [], allowUnmatched: false }, undefined);
  expect(result.source).toContain('"layers": []');
  expect(result.source).not.toContain('"kind": "auth"');
});

it('generates a profile-only mock layer without inventing an auth layer', () => {
  const result = scenarioFiles({ name: 'logged-in', profile: 'member', route: '', directory: '.fliwright/mocks', rules: [], allowUnmatched: false }, catalog);
  expect(result.source).toContain('"profile": "member"');
  expect(result.source).not.toContain('"rules"');
  expect(result.source).not.toContain('"kind": "auth"');
});
