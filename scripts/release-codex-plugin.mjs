import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function verifyCodexReleaseTag(manifest, tag) {
  if (manifest.name !== 'fliwright' || typeof manifest.version !== 'string' || !semverPattern.test(manifest.version)) {
    throw new Error('Expected fliwright plugin manifest with a strict semver version');
  }
  const expectedTag = `codex-v${manifest.version}`;
  if (tag !== expectedTag) throw new Error(`Tag ${tag ?? '(missing)'} does not match plugin version. Expected ${expectedTag}.`);
  return { version: manifest.version, prerelease: manifest.version.split('+')[0].includes('-') };
}

/** Package the validated plugin, including its hidden manifest, with a SHA-256 sidecar. */
export function packageCodexPlugin(root, outputDirectory, tag) {
  const pluginRoot = resolve(root, 'plugins/fliwright');
  const manifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'));
  const release = verifyCodexReleaseTag(manifest, tag);
  const output = resolve(outputDirectory);
  if (output === pluginRoot || output.startsWith(`${pluginRoot}${sep}`)) {
    throw new Error('Release output must be outside the plugin bundle');
  }
  mkdirSync(output, { recursive: true });
  const archive = join(output, `fliwright-codex-${release.version}.tar.gz`);
  const result = spawnSync('tar', ['-czf', archive, '-C', pluginRoot, '.'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Plugin archive failed: ${result.stderr}`);
  const checksum = `${archive}.sha256`;
  const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(checksum, `${digest}  ${basename(archive)}\n`);
  return { ...release, archive, checksum };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = process.argv[2];
  if (!outputDirectory) throw new Error('Usage: node scripts/release-codex-plugin.mjs <output-directory>');
  const release = packageCodexPlugin(resolve(import.meta.dirname, '..'), outputDirectory, process.env.GITHUB_REF_NAME);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${release.version}\nprerelease=${release.prerelease}\n`);
  }
  console.log(`Packaged ${release.archive}\nChecksum ${release.checksum}`);
}
