import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  CloudClient,
  CloudError,
  deviceInventorySchema,
  safeArtifactPath,
  catalogMockDirectorySchema,
  projectSchema,
  projectSubmissionSchema,
  submissionSchema,
} from '../src/index.js';

it('allows direct runs without a declared scenario while validating named selections', () => {
  const project = { id: 'app', name: 'App', repository: 'https://git.example.com/app.git', suites: { smoke: '*.test.ts' } };
  expect(projectSchema.parse(project).scenarios).toEqual([]);
  expect(projectSchema.parse({ ...project, autoRun: { enabled: true, selections: [{ suite: 'smoke' }] } }).autoRun.selections).toEqual([{ suite: 'smoke' }]);
  expect(projectSchema.safeParse({ ...project, autoRun: { selections: [{ suite: 'smoke', scenario: 'missing' }] } }).success).toBe(false);
  const input = { commit: 'a'.repeat(40), suite: 'smoke' };
  expect(submissionSchema.parse({ ...input, targetId: 'app' })).not.toHaveProperty('scenario');
  expect(projectSubmissionSchema.parse({ ...input, projectId: 'app', mode: 'suite' })).not.toHaveProperty('scenario');
  expect(projectSubmissionSchema.safeParse({ ...input, projectId: 'app', mode: 'suite', scenario: '' }).success).toBe(false);
});

it('transports bounded mock choices without response bodies or checkout escapes', () => {
  const endpoint = { endpoint: '/assets', method: 'GET', rules: ['success', 'empty'], activeRule: 'success' };
  const directory = { directory: '.fliwright/mocks', profiles: ['success', 'member'], endpoints: [endpoint] };
  expect(catalogMockDirectorySchema.parse(directory)).toEqual(directory);
  expect(catalogMockDirectorySchema.safeParse({ ...directory, directory: '../outside' }).success).toBe(false);
  expect(catalogMockDirectorySchema.safeParse({ ...directory, endpoints: [{ ...endpoint, body: { secret: 'not-metadata' } }] }).success).toBe(false);
});

it('accepts mock profiles aggregated across endpoints beyond the per-endpoint rule limit', () => {
  const rules = Array.from({ length: 101 }, (_, index) => `profile-${index}`);
  const directory = {
    directory: '.fliwright/mocks',
    profiles: rules,
    endpoints: [
      { endpoint: '/assets', method: 'GET', rules: rules.slice(0, 100), activeRule: rules[0] },
      { endpoint: '/orders', method: 'GET', rules: rules.slice(100), activeRule: rules[100] },
    ],
  };
  expect(catalogMockDirectorySchema.parse(directory)).toEqual(directory);
  expect(catalogMockDirectorySchema.safeParse({ ...directory, profiles: Array(100_001).fill('profile') }).success).toBe(false);
  expect(catalogMockDirectorySchema.safeParse({ ...directory, endpoints: [{ ...directory.endpoints[0], rules }] }).success).toBe(false);
});

it('validates native inventory as a wire contract without a host scanner', () => {
  expect(
    deviceInventorySchema.parse({
      scannedAt: '2026-10-19T00:00:00.000Z',
      devices: [
        {
          id: 'ios-phone',
          name: 'iPhone',
          platform: 'ios',
          kind: 'physical',
          state: 'online',
        },
        {
          id: 'avd:Pixel',
          avdName: 'Pixel',
          name: 'Pixel',
          platform: 'android',
          kind: 'simulator',
          state: 'shutdown',
        },
      ],
      diagnostics: [],
    }).devices,
  ).toHaveLength(2);
  expect(
    deviceInventorySchema.safeParse({
      scannedAt: 'invalid',
      devices: [],
      diagnostics: [],
    }).success,
  ).toBe(false);
});

it('uses the same artifact path policy for upload producers and consumers', () => {
  expect(safeArtifactPath('tests/example/attempt/screenshot.png')).toBe(
    'tests/example/attempt/screenshot.png',
  );
  for (const path of [
    '../run.json',
    '/run.json',
    'a\\run.json',
    'a//run.json',
    'a/./run.json',
    'cloud-publication.json',
    'script.sh',
    'a:b.json',
    'a\u0000.json',
  ]) {
    expect(() => safeArtifactPath(path)).toThrow(CloudError);
  }
});

it('sends bearer-authenticated binary publications and preserves server error codes', async () => {
  const requests: Array<{
    url: string;
    body: Buffer;
    headers: import('node:http').IncomingHttpHeaders;
  }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({
      url: req.url!,
      body: Buffer.concat(chunks),
      headers: req.headers,
    });
    res.setHeader('content-type', 'application/json');
    res.statusCode = req.url === '/denied' ? 409 : 200;
    res.end(
      JSON.stringify(
        req.url === '/denied' ? { error: 'Lease fenced' } : { ok: true },
      ),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as import('node:net').AddressInfo;
    const client = new CloudClient(
      `http://127.0.0.1:${address.port}`,
      'worker-token',
    );
    const bytes = Buffer.from([0, 255, 13, 10]);
    expect(
      await client.request('/upload', {
        method: 'PUT',
        body: bytes,
        publicationToken: 'upload-token',
      }),
    ).toEqual({ ok: true });
    expect(requests[0].body).toEqual(bytes);
    expect(requests[0].headers).toMatchObject({
      authorization: 'Bearer worker-token',
      'content-type': 'application/octet-stream',
      'x-publication-token': 'upload-token',
    });
    await expect(client.request('/denied')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Lease fenced',
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
