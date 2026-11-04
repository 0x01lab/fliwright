import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkHostedDependencies, prepareRelease, resolveRelease, verifyPublishedPackage } from './pub-release.mjs';

const names = ['fliwright_bridge', 'fliwright_bridge_riverpod', 'fliwright_design_qa'];
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('routes all package tags and rejects mismatched identities and versions', async () => {
  for (const name of names) {
    const release = await resolveRelease(`${name}-v0.1.0`);
    assert.equal(release.name, name);
    assert.equal(release.version, '0.1.0');
    assert.ok(release.symbol);
    await assert.rejects(resolveRelease(`${name}-v0.2.0`), /does not match/);
  }
  await assert.rejects(resolveRelease('npm-v0.1.0'), /Unsupported/);
  await assert.rejects(resolveRelease('fliwright_bridge-v../invalid'), /Invalid release version/);
  const repository = await mkdtemp(join(tmpdir(), 'fliwright-pub-test-'));
  try {
    const dir = join(repository, 'packages', 'fliwright-bridge');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'pubspec.yaml'), 'name: wrong_name\nversion: 0.1.0\n');
    await assert.rejects(resolveRelease('fliwright_bridge-v0.1.0', repository), /does not match/);
    await writeFile(join(dir, 'pubspec.yaml'),
      'name: fliwright_bridge\nversion: 0.1.0\ndependency_overrides:\n  bridge: any\n');
    await assert.rejects(resolveRelease('fliwright_bridge-v0.1.0', repository), /without workspace overrides/);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});

test('skips only a confirmed existing version and allows a new version of an existing package', async () => {
  const release = await resolveRelease('fliwright_bridge-v0.1.0');
  const urls = [];
  assert.equal(await prepareRelease(release, async (url) => {
    urls.push(url);
    return jsonResponse({ version: '0.1.0', pubspec: { name: release.name } });
  }), true);
  assert.deepEqual(urls, ['https://pub.dev/api/packages/fliwright_bridge/versions/0.1.0']);
  assert.equal(await prepareRelease(release, async (url) => url.endsWith('/versions/0.1.0')
    ? new Response('<not-found/>', { status: 404 })
    : jsonResponse({ name: release.name })), false);
});

test('fails closed on unavailable or malformed registry metadata and explains first publication', async () => {
  const release = await resolveRelease('fliwright_bridge-v0.1.0');
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(prepareRelease(release, async () => jsonResponse({}, status)), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(prepareRelease(release, async () => { throw new Error('network failure'); }), /network failure/);
  await assert.rejects(prepareRelease(release, async () => jsonResponse({ version: '0.2.0' })), /Unexpected/);
  await assert.rejects(prepareRelease(release, async () => new Response('bad json')), /JSON/);
  await assert.rejects(prepareRelease(release, async () => new Response('', { status: 404 })), /first version manually/);
});

test('preflight uses only the publish manifest with an isolated cache and reports missing hosted dependencies', async () => {
  const release = await resolveRelease('fliwright_bridge_riverpod-v0.1.0');
  let temporary;
  await assert.rejects(checkHostedDependencies(release, async (args, { cwd, env }) => {
    temporary = dirname(cwd);
    assert.deepEqual(args, ['pub', 'get']);
    assert.notEqual(cwd, release.dir);
    assert.equal(env.PUB_HOSTED_URL, 'https://pub.dev');
    assert.equal(env.PUB_CACHE, join(temporary, 'pub-cache'));
    assert.deepEqual(await readdir(cwd), ['pubspec.yaml']);
    assert.equal(await readFile(join(cwd, 'pubspec.yaml'), 'utf8'), release.pubspec);
    throw new Error('fliwright_bridge does not exist');
  }), /Publish a compatible fliwright_bridge version first[\s\S]*does not exist/);
  await assert.rejects(access(temporary));
});

test('consumer installs exact hosted versions, retries propagation, then analyzes and compiles each public entry', async () => {
  for (const name of names) {
    const release = await resolveRelease(`${name}-v0.1.0`);
    const commands = [];
    const delays = [];
    let temporary;
    await verifyPublishedPackage(release, {
      pause: async (delay) => { delays.push(delay); },
      run: async (args, { cwd, env }) => {
        commands.push(args);
        temporary = dirname(cwd);
        const manifest = await readFile(join(cwd, 'pubspec.yaml'), 'utf8');
        assert.ok(manifest.includes(`  ${name}:\n    hosted: https://pub.dev\n    version: '0.1.0'`));
        assert.ok(!manifest.includes('path:') && !manifest.includes('dependency_overrides:'));
        assert.equal(env.PUB_HOSTED_URL, 'https://pub.dev');
        assert.equal(env.PUB_CACHE, join(temporary, 'pub-cache'));
        const source = await readFile(join(cwd, 'test', 'published_api_test.dart'), 'utf8');
        assert.ok(source.includes(`package:${name}/${name}.dart`));
        assert.ok(source.includes(`published.${release.symbol}`));
        if (commands.length < 3) throw new Error('registry propagation delay');
      },
    });
    assert.deepEqual(commands, [
      ['pub', 'get'], ['pub', 'get'], ['pub', 'get'],
      ['analyze', '--no-pub'], ['test', '--no-pub', '--concurrency=1'],
    ]);
    assert.deepEqual(delays, [15_000, 15_000]);
    await assert.rejects(access(temporary));
  }
});

test('consumer bounds install retries and cleans up on failure without retrying API compilation failures', async () => {
  const release = await resolveRelease('fliwright_bridge-v0.1.0');
  let attempts = 0;
  let temporary;
  await assert.rejects(verifyPublishedPackage(release, {
    pause: async () => {},
    run: async (_args, { cwd }) => {
      temporary = dirname(cwd);
      attempts += 1;
      throw new Error('permanent install failure');
    },
  }), /permanent install failure/);
  assert.equal(attempts, 10);
  await assert.rejects(access(temporary));
  const commands = [];
  await assert.rejects(verifyPublishedPackage(release, {
    pause: async () => assert.fail('API failures must not retry'),
    run: async (args, { cwd }) => {
      temporary = dirname(cwd);
      commands.push(args);
      if (args[0] === 'analyze') throw new Error('missing public API');
    },
  }), /missing public API/);
  assert.deepEqual(commands, [['pub', 'get'], ['analyze', '--no-pub']]);
  await assert.rejects(access(temporary));
});
