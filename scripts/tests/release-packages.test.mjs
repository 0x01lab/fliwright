import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getReleasePackages, verifyReleaseVersion, registryConsumerManifest } from '../release-packages.mjs';

function fixture(t, manifests) {
  const root = mkdtempSync(join(tmpdir(), 'release-packages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [directory, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, 'packages', directory), { recursive: true });
    writeFileSync(join(root, 'packages', directory, 'package.json'), JSON.stringify({ version: '1.2.3', ...manifest }));
  }
  return root;
}

test('discovers the complete public graph in dependency order, including native and peers', (t) => {
  const root = fixture(t, {
    cli: { name: '@fliwright/cli', dependencies: { '@fliwright/native': 'workspace:*' }, peerDependencies: { '@fliwright/vitest': 'workspace:*' } },
    native: { name: '@fliwright/native', dependencies: { '@fliwright/core': 'workspace:*' } },
    core: { name: '@fliwright/core' },
    vitest: { name: '@fliwright/vitest', dependencies: { '@fliwright/native': 'workspace:*' } },
    cloud: { name: '@fliwright/cloud', private: true },
    editor: { name: 'fliwright-vscode' },
  });
  const packages = getReleasePackages(root);
  assert.deepEqual(packages.map(p => p.name), ['@fliwright/core', '@fliwright/native', '@fliwright/vitest', '@fliwright/cli']);
  verifyReleaseVersion(packages, 'npm-v1.2.3');
  const manifest = registryConsumerManifest(packages, '1.2.3');
  assert.equal(manifest.dependencies['@fliwright/native'], '1.2.3');
  assert.ok(Object.values(manifest.dependencies).every(value => value === '1.2.3'));
});

test('rejects an incomplete release, mismatched versions and dependency cycles', (t) => {
  const root = fixture(t, { cli: { name: '@fliwright/cli', dependencies: { '@fliwright/native': 'workspace:*' } } });
  assert.throws(() => getReleasePackages(root), /native.*public/i);
  const mismatch = [{ name: '@fliwright/native', version: '1.2.2' }];
  assert.throws(() => verifyReleaseVersion(mismatch, 'npm-v1.2.3'), /native.*1.2.2/);
  assert.throws(() => verifyReleaseVersion(mismatch, 'v1.2.2'), /npm-v/);
  const cycle = fixture(t, {
    a: { name: '@fliwright/a', dependencies: { '@fliwright/b': 'workspace:*' } },
    b: { name: '@fliwright/b', dependencies: { '@fliwright/a': 'workspace:*' } },
  });
  assert.throws(() => getReleasePackages(cycle), /cycle/i);
});
