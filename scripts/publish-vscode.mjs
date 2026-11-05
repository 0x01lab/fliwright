import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

/** Resume a partial release without republishing an immutable Marketplace version. */
export async function publishVsCode(manifest, query = fetch, run = promisify(execFile)) {
  const response = await query('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: `${manifest.publisher}.${manifest.name}` }] }], flags: 1 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Marketplace version query failed: HTTP ${response.status}`);
  const result = await response.json();
  if (!Array.isArray(result.results) || result.results.length !== 1 || !Array.isArray(result.results[0].extensions)) throw new Error('Invalid Marketplace version query response');
  const extension = result.results[0].extensions.find(item => item.extensionName === manifest.name && item.publisher?.publisherName === manifest.publisher);
  if (extension && !Array.isArray(extension.versions)) throw new Error('Invalid Marketplace version query response');
  if (extension?.versions.some(item => item.version === manifest.version)) return 'existing';
  const { stdout = '', stderr = '' } = await run('pnpm', ['--filter', manifest.name, 'run', 'publish:vsce:package'], { cwd: resolve(import.meta.dirname, '..'), maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  return 'published';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile(new URL('../packages/fliwright-vscode/package.json', import.meta.url), 'utf8'));
  console.log(`Marketplace ${manifest.publisher}.${manifest.name}@${manifest.version}: ${await publishVsCode(manifest)}`);
}
