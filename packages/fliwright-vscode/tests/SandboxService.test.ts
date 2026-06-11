import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { SandboxService } from '../src/sandbox/SandboxService.js';
import type { MockDiscoveryResult, MockRuleEntry } from '../src/types.js';

describe('SandboxService', () => {
  it('applies one selected mock rule through driver.mock.route', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const entry = mockRule('success');

    const applied = await service.applyRule({ mock: { route } } as any, entry);

    expect(route).toHaveBeenCalledWith('/v1/token', {
      method: 'GET',
      status: 200,
      delay: undefined,
      headers: undefined,
      body: { ok: true },
    });
    expect(applied.ruleName).toBe('success');
    expect(service.isApplied(entry)).toBeDefined();
  });

  it('keeps only one active rule per method and endpoint', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const success = mockRule('success');
    const error = mockRule('error');
    error.rule.status = 400;

    await service.applyRule({ mock: { route } } as any, success);
    await service.applyRule({ mock: { route } } as any, error);

    expect(service.getAppliedRules()).toHaveLength(1);
    expect(service.getAppliedRules()[0]?.ruleName).toBe('error');
    expect(service.isApplied(success)).toBeUndefined();
    expect(service.isApplied(error)).toBeDefined();
  });

  it('routes multiple rules directly through the same driver', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const driver = { mock: { route } } as any;
    const first = mockRule('success');
    const second = mockRule('error');
    second.endpoint = '/v1/profile';

    await service.applyRule(driver, first);
    await service.applyRule(driver, second);

    expect(route).toHaveBeenCalledTimes(2);
  });

  it('stops only the currently active rule for an endpoint', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const removeRoute = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const success = mockRule('success');
    const error = mockRule('error');

    await service.applyRule({ mock: { route } } as any, success);

    await expect(service.stopRule({ mock: { removeRoute } } as any, error)).resolves.toBe(false);
    expect(removeRoute).not.toHaveBeenCalled();
    expect(service.getAppliedRules()).toHaveLength(1);

    await expect(service.stopRule({ mock: { removeRoute } } as any, success)).resolves.toBe(true);
    expect(removeRoute).toHaveBeenCalledWith('/v1/token', 'GET');
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('applies index default rules and skips invalid files', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();

    const result = await service.applyDefaultMocks({ mock: { route } } as any, discovery());

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.ruleName).toBe('error');
    expect(result.skipped).toBe(1);
    expect(route).toHaveBeenCalledWith('/v1/token', expect.objectContaining({ status: 500 }));
  });

  it('applies default mocks in bulk without starting a controller', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const result = discovery();
    result.endpoints.push({
      kind: 'endpoint',
      uri: Uri.file('/tmp/profile.json'),
      indexed: true,
      endpointFile: {
        version: 1,
        name: 'Profile',
        method: 'POST',
        endpoint: '/v1/profile',
        rules: [
          { name: 'success', status: 201 },
        ],
      },
    });

    await service.applyDefaultMocks({ mock: { route } } as any, result);

    expect(route).toHaveBeenCalledTimes(2);
  });

  it('clears routes and tracked state', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    await service.applyRule({ mock: { route } } as any, mockRule('success'));

    const count = await service.clear({ mock: { clear } } as any);

    expect(count).toBe(1);
    expect(clear).toHaveBeenCalledOnce();
    expect(service.getAppliedRules()).toHaveLength(0);
  });
});

function mockRule(ruleName: string): MockRuleEntry {
  return {
    kind: 'rule',
    uri: Uri.file('/tmp/token.json'),
    endpoint: '/v1/token',
    method: 'GET',
    rule: { name: ruleName, status: 200, body: { ok: true } },
    isDefault: false,
  };
}

function discovery(): MockDiscoveryResult {
  return {
    root: Uri.file('/tmp/.fliwright/mocks'),
    indexUri: Uri.file('/tmp/.fliwright/mocks/mock-index.json'),
    endpoints: [
      {
        kind: 'endpoint',
        uri: Uri.file('/tmp/token.json'),
        indexed: true,
        defaultRule: 'error',
        endpointFile: {
          version: 1,
          name: 'Token',
          method: 'GET',
          endpoint: '/v1/token',
          rules: [
            { name: 'success', status: 200 },
            { name: 'error', status: 500 },
          ],
        },
      },
    ],
    invalid: [
      {
        kind: 'invalid',
        uri: Uri.file('/tmp/bad.json'),
        label: 'bad.json',
        error: 'bad json',
      },
    ],
  };
}
