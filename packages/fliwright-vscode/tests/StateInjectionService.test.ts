import { describe, expect, it, vi } from 'vitest';
import { StateInjectionService } from '../src/state/StateInjectionService.js';

describe('StateInjectionService', () => {
  it('lists, reads, and overrides riverpod providers through VM service extensions', async () => {
    const sendRequest = vi.fn(async (method: string) => {
      if (method === 'ext.fliwright.riverpod.list') {
        return { providers: [{ key: 'counterProvider', type: 'int', value: 1 }] };
      }
      if (method === 'ext.fliwright.riverpod.read') {
        return { value: 1 };
      }
      return {};
    });
    const driver = { sendRequest } as any;
    const service = new StateInjectionService();

    await expect(service.listProviders(driver)).resolves.toEqual([
      { kind: 'stateProvider', key: 'counterProvider', type: 'int', value: 1 },
    ]);
    await expect(service.read(driver, 'counterProvider')).resolves.toBe(1);
    await service.override(driver, 'counterProvider', 2);

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.riverpod.override', {
      provider: 'counterProvider',
      value: '2',
    });
  });
});
