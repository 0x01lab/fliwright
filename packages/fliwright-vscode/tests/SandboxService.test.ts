import { describe, expect, it, vi } from 'vitest';
import { Uri } from 'vscode';
import { SandboxService } from '../src/sandbox/SandboxService.js';
import type { MockDiscoveryResult, MockRuleEntry } from '../src/types.js';

describe('SandboxService', () => {
  it('applies one selected mock rule through driver.mock.route', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const startServer = vi.fn().mockResolvedValue('http://127.0.0.1:1234');
    const configureFlutterController = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const entry = mockRule('success');

    const applied = await service.applyRule({ mock: { route, startServer, configureFlutterController } } as any, entry);

    expect(startServer).toHaveBeenCalledOnce();
    expect(configureFlutterController).toHaveBeenCalledWith('http://127.0.0.1:1234');
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
    const startServer = vi.fn().mockResolvedValue('http://127.0.0.1:1234');
    const configureFlutterController = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const success = mockRule('success');
    const error = mockRule('error');
    error.rule.status = 400;

    await service.applyRule({ mock: { route, startServer, configureFlutterController } } as any, success);
    await service.applyRule({ mock: { route, startServer, configureFlutterController } } as any, error);

    expect(service.getAppliedRules()).toHaveLength(1);
    expect(service.getAppliedRules()[0]?.ruleName).toBe('error');
    expect(service.isApplied(success)).toBeUndefined();
    expect(service.isApplied(error)).toBeDefined();
  });

  it('stops only the currently active rule for an endpoint', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const removeRoute = vi.fn().mockResolvedValue(undefined);
    const startServer = vi.fn().mockResolvedValue('http://127.0.0.1:1234');
    const configureFlutterController = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    const success = mockRule('success');
    const error = mockRule('error');

    await service.applyRule({ mock: { route, startServer, configureFlutterController } } as any, success);

    await expect(service.stopRule({ mock: { removeRoute } } as any, error)).resolves.toBe(false);
    expect(removeRoute).not.toHaveBeenCalled();
    expect(service.getAppliedRules()).toHaveLength(1);

    await expect(service.stopRule({ mock: { removeRoute } } as any, success)).resolves.toBe(true);
    expect(removeRoute).toHaveBeenCalledWith('/v1/token', 'GET');
    expect(service.getAppliedRules()).toHaveLength(0);
  });

  it('applies index default rules and skips invalid files', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const startServer = vi.fn().mockResolvedValue('http://127.0.0.1:1234');
    const configureFlutterController = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();

    const result = await service.applyDefaultMocks({ mock: { route, startServer, configureFlutterController } } as any, discovery());

    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]?.ruleName).toBe('error');
    expect(result.skipped).toBe(1);
    expect(route).toHaveBeenCalledWith('/v1/token', expect.objectContaining({ status: 500 }));
  });

  it('clears routes and tracked state', async () => {
    const route = vi.fn().mockResolvedValue(undefined);
    const startServer = vi.fn().mockResolvedValue('http://127.0.0.1:1234');
    const configureFlutterController = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    const service = new SandboxService();
    await service.applyRule({ mock: { route, startServer, configureFlutterController } } as any, mockRule('success'));

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
