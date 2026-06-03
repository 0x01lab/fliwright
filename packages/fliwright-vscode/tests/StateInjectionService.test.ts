import { describe, expect, it, vi } from 'vitest';
import { StateInjectionService } from '../src/state/StateInjectionService.js';

describe('StateInjectionService', () => {
  it('reads riverpod status from adapters that expose it', async () => {
    const state = {
      status: vi.fn(async () => ({
        observerInstalled: true,
        containerReady: false,
        providerCount: 0,
        watching: ['counterProvider'],
      })),
    };
    const driver = { state } as any;
    const service = new StateInjectionService();

    await expect(service.status(driver)).resolves.toEqual({
      observerInstalled: true,
      containerReady: false,
      providerCount: 0,
      watching: ['counterProvider'],
    });
  });

  it('lists, reads, and overrides riverpod providers through the state adapter', async () => {
    const state = {
      listProviders: vi.fn(async () => [{ key: 'counterProvider', name: 'counterProvider', type: 'int', value: 1, overridable: true }]),
      read: vi.fn(async () => 1),
      override: vi.fn(async () => ({ provider: 'counterProvider', overridden: true, value: 2 })),
    };
    const driver = { state } as any;
    const service = new StateInjectionService();

    await expect(service.listProviders(driver)).resolves.toEqual([
      {
        kind: 'stateProvider',
        key: 'counterProvider',
        type: 'int',
        value: 1,
        readable: true,
        overridable: true,
        watching: undefined,
        error: undefined,
      },
    ]);
    await expect(service.read(driver, 'counterProvider')).resolves.toBe(1);
    await expect(service.override(driver, 'counterProvider', 2)).resolves.toEqual({
      provider: 'counterProvider',
      overridden: true,
      value: 2,
      message: undefined,
    });

    expect(state.override).toHaveBeenCalledWith('counterProvider', 2);
  });

  it('preserves override false results as warnings for callers', async () => {
    const driver = {
      state: {
        override: vi.fn(async () => ({
          provider: 'readonlyProvider',
          overridden: false,
          message: 'Provider is not registered as overridable.',
        })),
      },
    } as any;
    const service = new StateInjectionService();

    await expect(service.override(driver, 'readonlyProvider', 2)).resolves.toEqual({
      provider: 'readonlyProvider',
      overridden: false,
      value: 2,
      message: 'Provider is not registered as overridable.',
    });
  });

  it('watches providers through the state adapter', async () => {
    const unsubscribe = vi.fn();
    const state = {
      watch: vi.fn(async () => unsubscribe),
    };
    const driver = { state } as any;
    const service = new StateInjectionService();
    const onChange = vi.fn();

    await expect(service.watch(driver, 'counterProvider', onChange)).resolves.toBe(unsubscribe);

    expect(state.watch).toHaveBeenCalledWith('counterProvider', onChange);
  });
});
