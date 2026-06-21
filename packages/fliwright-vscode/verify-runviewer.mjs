import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const result = await build({
  entryPoints: ['src/runviewer/getRunViewerHtml.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  absWorkingDir: process.cwd(),
});
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64');
const { getRunViewerHtml } = await import(dataUrl);

const runDir = '/Users/leo.he/projects/exio/exio_app/.fliwright/runs/2026-06-21T08-54-47-auto-login-fill';
const timeline = JSON.parse(readFileSync(`${runDir}/timeline.json`, 'utf8'));
const logs = readFileSync(`${runDir}/logs/events.jsonl`, 'utf8')
  .split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));

const html = getRunViewerHtml(timeline, logs, {
  cspSource: 'https://file+.vscode-resource.vscode-cdn.net',
  nonce: 'testnonce123',
  screenshotBaseUrl: 'vscode-webview://run-dir',
});
writeFileSync('/tmp/runviewer-preview.html', html);

const checks = [
  ['run title', html.includes('auto login fill')],
  ['run status passed', html.includes('passed')],
  ['node page-1', html.includes('page-1')],
  ['node assertion-12', html.includes('assertion-12')],
  ['screenshot path', html.includes('artifacts/screenshots/frame-7.png')],
  ['screenshot base url', html.includes('vscode-webview://run-dir/artifacts/screenshots/frame-7.png')],
  ['failure message', html.includes('toBeVisible failed')],
  ['recovery hint', html.includes('Recovery hints')],
  ['csp nonce', html.includes("style-src 'nonce-testnonce123'")],
  ['embedded timeline', html.includes('"id":"assertion-12"')],
  ['embedded logs', html.includes('"timelineNodeId":"assertion-12"')],
  ['metadata matcher', html.includes('toBeVisible')],
];
let ok = true;
for (const [name, pass] of checks) { console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`); if (!pass) ok = false; }
const selectCount = (html.match(/selectNode\(/g) || []).length;
console.log(`node rows with selectNode: ${selectCount} (expect 12)`);
if (selectCount !== 12) { ok = false; }
// Sanity: balanced enough to be parseable — check it ends with closing tags.
console.log('ends with </html>:', html.trimEnd().endsWith('</html>'));
console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);
