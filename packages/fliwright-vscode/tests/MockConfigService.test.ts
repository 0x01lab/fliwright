import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { MockConfigService } from '../src/sandbox/MockConfigService.js';
import { createWorkspace, readText, writeJson, writeText } from './helpers/workspace.js';

describe('MockConfigService', () => {
  it('discovers valid endpoint files', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/api/token.json', endpointFile('/v1/token', 'success'));

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0]?.endpointFile.endpoint).toBe('/v1/token');
    expect(result.endpoints[0]?.endpointFile.rules[0]?.name).toBe('success');
    expect(result.invalid).toHaveLength(0);
  });

  it('keeps invalid JSON visible as invalid file entries', async () => {
    const root = await createWorkspace();
    await writeText(root, '.fliwright/mocks/api/broken.json', '{');

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.endpoints).toHaveLength(0);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0]?.label).toBe('broken.json');
  });

  it('keeps invalid schema files visible', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/api/broken.json', {
      version: 1,
      name: 'Broken',
      method: 'TRACE',
      endpoint: 'v1/broken',
      rules: [],
    });

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.invalid[0]?.error).toContain('method must be one of');
  });

  it('loads index default rules and indexed state', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/mock-index.json', {
      version: 1,
      defaultRule: 'error',
      files: ['api/token.json'],
    });
    await writeJson(root, '.fliwright/mocks/api/token.json', {
      ...endpointFile('/v1/token', 'success'),
      rules: [
        { name: 'success', status: 200 },
        { name: 'error', status: 500 },
      ],
    });

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.index?.defaultRule).toBe('error');
    expect(result.endpoints[0]?.indexed).toBe(true);
    expect(result.endpoints[0]?.defaultRule).toBe('error');
  });

  it('discovers endpoint files with baseRule overrides as expanded rules', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/api/user.json', {
      version: 1,
      name: 'User',
      method: 'GET',
      endpoint: '/v1/user',
      baseRule: {
        status: 200,
        delay: 25,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          success: true,
        },
      },
      rules: [
        {
          name: 'success',
          body: {
            name: 'Ada',
          },
        },
        {
          name: 'error',
          status: 500,
          removeBodyFields: ['success'],
          body: {
            error: 'fail',
          },
        },
      ],
    });

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.invalid).toHaveLength(0);
    expect(result.endpoints[0]?.endpointFile.rules).toEqual([
      {
        name: 'success',
        status: 200,
        delay: 25,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          success: true,
          name: 'Ada',
        },
      },
      {
        name: 'error',
        status: 500,
        delay: 25,
        headers: {
          'Content-Type': 'application/json',
        },
        body: {
          error: 'fail',
        },
      },
    ]);
  });

  it('accepts compact files whose first rule inherits status from baseRule', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/api/get-user-info-api.json', {
      version: 1,
      name: 'User Info API',
      method: 'POST',
      endpoint: '/api/v1/user/info',
      baseRule: {
        status: 200,
        delay: 0,
        headers: { 'Content-Type': 'application/json' },
        body: {
          username: 'qa-user',
          phone: '+85268****85',
          otpConfigured: true,
        },
      },
      rules: [
        {
          name: 'security-real-data',
        },
        {
          name: 'security-mobile-add',
          removeBodyFields: ['phone'],
          body: { otpConfigured: false },
        },
      ],
    });

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.invalid).toHaveLength(0);
    expect(result.endpoints[0]?.endpointFile.rules[0]).toEqual({
      name: 'security-real-data',
      status: 200,
      delay: 0,
      headers: { 'Content-Type': 'application/json' },
      body: {
        username: 'qa-user',
        phone: '+85268****85',
        otpConfigured: true,
      },
    });
    expect(result.endpoints[0]?.endpointFile.rules[1]).toEqual({
      name: 'security-mobile-add',
      status: 200,
      delay: 0,
      headers: { 'Content-Type': 'application/json' },
      body: {
        username: 'qa-user',
        otpConfigured: false,
      },
    });
  });

  it('requires status on either baseRule or each rule', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/api/broken.json', {
      version: 1,
      name: 'Broken',
      method: 'GET',
      endpoint: '/v1/broken',
      rules: [{ name: 'success' }],
    });

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.endpoints).toHaveLength(0);
    expect(result.invalid[0]?.error).toContain('rules[0].status must be an HTTP status code');
  });

  it('validates removeBodyFields entries', async () => {
    const root = await createWorkspace();
    await writeJson(root, '.fliwright/mocks/api/broken.json', {
      version: 1,
      name: 'Broken',
      method: 'GET',
      endpoint: '/v1/broken',
      baseRule: { status: 200 },
      rules: [{ name: 'success', removeBodyFields: ['ok', ''] }],
    });

    const result = await new MockConfigService().discover(Uri.file(root));

    expect(result.endpoints).toHaveLength(0);
    expect(result.invalid[0]?.error).toContain('rules[0].removeBodyFields must be an array of non-empty strings');
  });

  it('creates endpoint templates under .fliwright/mocks/api', async () => {
    const root = await createWorkspace();

    const uri = await new MockConfigService().createTemplate(Uri.file(root), '../unsafe');
    const raw = await readText(root, '.fliwright/mocks/api/unsafe.json');

    expect(uri.fsPath).toBe(path.join(root, '.fliwright/mocks/api/unsafe.json'));
    expect(JSON.parse(raw)).toMatchObject({
      version: 1,
      method: 'GET',
      endpoint: '/api/example',
    });
  });
});

function endpointFile(endpoint: string, ruleName: string) {
  return {
    version: 1,
    name: endpoint,
    method: 'GET',
    endpoint,
    rules: [
      {
        name: ruleName,
        status: 200,
        body: { ok: true },
      },
    ],
  };
}
