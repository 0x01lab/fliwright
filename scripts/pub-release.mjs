import { execFile } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const registry = 'https://pub.dev';
const packages = {
  fliwright_bridge: { directory: 'fliwright-bridge', symbol: 'FliwrightBridge' },
  fliwright_bridge_riverpod: { directory: 'fliwright-bridge-riverpod', symbol: 'FliwrightRiverpodObserver' },
  fliwright_design_qa: { directory: 'fliwright-design-qa', symbol: 'DesignQaSdk' },
};

export async function resolveRelease(tag, repository = root) {
  const match = /^(fliwright_bridge|fliwright_bridge_riverpod|fliwright_design_qa)-v(.+)$/.exec(tag ?? '');
  if (!match) throw new Error(`Unsupported pub.dev release tag: ${tag ?? '(missing)'}`);
  const [, name, version] = match;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  const { directory, symbol } = packages[name];
  const dir = join(repository, 'packages', directory);
  const pubspec = await readFile(join(dir, 'pubspec.yaml'), 'utf8');
  const scalar = (key) => new RegExp(`^${key}:[ \\t]*([^\\n#]+)`, 'm')
    .exec(pubspec)?.[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  if (scalar('name') !== name || scalar('version') !== version) {
    throw new Error(`Tag ${tag} does not match name/version in ${dir}/pubspec.yaml.`);
  }
  if (/^(dependency_overrides|resolution|workspace):/m.test(pubspec)) {
    throw new Error('Release pubspec.yaml must resolve hosted dependencies without workspace overrides.');
  }
  return { name, version, dir, symbol, pubspec };
}

async function registryJson(path, fetchRegistry) {
  const response = await fetchRegistry(`${registry}/api/packages/${path}`, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'cache-control': 'no-cache' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`pub.dev metadata request failed: HTTP ${response.status} (${path}).`);
  return response.json();
}

export async function prepareRelease(release, fetchRegistry = fetch) {
  const metadata = await registryJson(`${release.name}/versions/${release.version}`, fetchRegistry);
  if (metadata) {
    if (metadata.version !== release.version || metadata.pubspec?.name !== release.name) {
      throw new Error(`Unexpected pub.dev metadata for ${release.name}@${release.version}.`);
    }
    console.log(`${release.name}@${release.version} already exists; skipping publish.`);
    return true;
  }
  const existing = await registryJson(release.name, fetchRegistry);
  if (!existing) {
    throw new Error(`${release.name} has not been published. Publish its first version manually with `
      + '`flutter pub publish`, then enable GitHub automated publishing in its pub.dev Admin page.');
  }
  if (existing.name !== release.name) throw new Error(`Unexpected pub.dev package: ${existing.name}.`);
  return false;
}

async function runFlutter(args, options) {
  console.log(`flutter ${args.join(' ')} (${options.cwd})`);
  try {
    const { stdout, stderr } = await execFileAsync('flutter', args, {
      ...options, timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
    });
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  } catch (error) {
    throw new Error(`${error.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`, { cause: error });
  }
}

async function withProject(action) {
  const temporary = await mkdtemp(join(tmpdir(), 'fliwright-pub-'));
  const cwd = join(temporary, 'consumer');
  await mkdir(cwd);
  const env = { ...process.env, PUB_HOSTED_URL: registry, PUB_CACHE: join(temporary, 'pub-cache') };
  try {
    return await action({ cwd, env });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function checkHostedDependencies(release, run = runFlutter) {
  await withProject(async (options) => {
    // Copy only the release manifest: no workspace lock, path overrides, or cache.
    await writeFile(join(options.cwd, 'pubspec.yaml'), release.pubspec);
    try {
      await run(['pub', 'get'], options);
    } catch (error) {
      throw new Error(`Hosted dependencies for ${release.name} could not resolve. `
        + 'Publish a compatible fliwright_bridge version first for dependent packages.\n'
        + error.message, { cause: error });
    }
  });
}

export async function verifyPublishedPackage(release, {
  run = runFlutter,
  pause = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds)),
} = {}) {
  await withProject(async (options) => {
    await writeFile(join(options.cwd, 'pubspec.yaml'), [
      'name: fliwright_release_consumer',
      'publish_to: none',
      'environment:',
      "  sdk: '^3.5.0'",
      'dependencies:',
      '  flutter:',
      '    sdk: flutter',
      `  ${release.name}:`,
      `    hosted: ${registry}`,
      `    version: '${release.version}'`,
      'dev_dependencies:',
      '  flutter_test:',
      '    sdk: flutter',
      '',
    ].join('\n'));
    await mkdir(join(options.cwd, 'test'));
    await writeFile(join(options.cwd, 'test', 'published_api_test.dart'), [
      `import 'package:${release.name}/${release.name}.dart' as published;`,
      "import 'package:flutter_test/flutter_test.dart';",
      '',
      'void main() {',
      "  test('loads the published public API', () {",
      `    expect(published.${release.symbol}, isA<Type>());`,
      '  });',
      '}',
      '',
    ].join('\n'));

    // Metadata and archives can become visible at different times after upload.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await run(['pub', 'get'], options);
        break;
      } catch (error) {
        if (attempt === 10) throw error;
        console.log(`Registry install attempt ${attempt}/10 failed; retrying in 15 seconds.`);
        await pause(15_000);
      }
    }
    await run(['analyze', '--no-pub'], options);
    await run(['test', '--no-pub', '--concurrency=1'], options);
    console.log(`Verified clean pub.dev consumer for ${release.name}@${release.version}.`);
  });
}

async function main(command) {
  const release = await resolveRelease(process.env.GITHUB_REF_NAME);
  if (command === 'prepare') {
    const published = await prepareRelease(release);
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT,
        `dir=${release.dir}\nname=${release.name}\nversion=${release.version}\npublished=${published}\n`);
    }
  } else if (command === 'check-dependencies') {
    await checkHostedDependencies(release);
  } else if (command === 'verify') {
    await verifyPublishedPackage(release);
  } else {
    throw new Error('Usage: GITHUB_REF_NAME=<package>-v<version> node scripts/pub-release.mjs '
      + '<prepare|check-dependencies|verify>');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2]);
}
