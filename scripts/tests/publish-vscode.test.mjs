import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishVsCode } from '../publish-vscode.mjs';

const manifest = { publisher: 'fliwright', name: 'fliwright-vscode', version: '0.2.0' };
const response = versions => new Response(JSON.stringify({ results: [{ extensions: [{ extensionName: manifest.name, publisher: { publisherName: manifest.publisher }, versions: versions.map(version => ({ version })) }] }] }));

test('skips an already published exact version so release asset upload can be retried', async () => {
  let calls = 0;
  const result = await publishVsCode(manifest, async (_url, options) => {
    assert.equal(JSON.parse(options.body).filters[0].criteria[0].value, 'fliwright.fliwright-vscode');
    return response(['0.2.0', '0.1.0']);
  }, async () => calls++);
  assert.equal(result, 'existing');
  assert.equal(calls, 0);
});

test('publishes a missing version and propagates publication failures', async () => {
  let calls = 0;
  assert.equal(await publishVsCode(manifest, async () => response(['0.1.0']), async () => calls++), 'published');
  assert.equal(calls, 1);
  await assert.rejects(publishVsCode(manifest, async () => response([]), async () => { throw new Error('publish rejected'); }), /publish rejected/);
});

test('fails closed on Marketplace errors or malformed replies instead of blindly publishing', async () => {
  const run = async () => { assert.fail('must not publish without a successful version query'); };
  await assert.rejects(publishVsCode(manifest, async () => new Response('unavailable', { status: 503 }), run), /503/);
  await assert.rejects(publishVsCode(manifest, async () => new Response('{}'), run), /response/i);
});
