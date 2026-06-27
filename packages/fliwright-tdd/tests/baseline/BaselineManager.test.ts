import { describe, expect, it, vi } from 'vitest';
import { BaselineManager } from '../../src/baseline/BaselineManager.js';

describe('BaselineManager', () => {
  it('runs built-in navigation and mock adapters and reports unsupported categories', async () => {
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['navigation', 'mock', 'storage'],
    });

    expect(driver.page.resetToHome).toHaveBeenCalledWith({ homeRoute: '/home' });
    expect(driver.mock.clear).toHaveBeenCalled();
    expect(driver.mock.clearCalls).toHaveBeenCalled();
    // storage is unsupported because the driver exposes no storage facade
    // (bridge extension absent → graceful degradation, design §6.5 / §11).
    expect(report.unsupported).toEqual(['storage']);
    expect(report.version).toBe(1);
  });

  it("reports storage 'ok' when the driver exposes a storage facade that succeeds", async () => {
    const reset = vi.fn(async () => ({ status: 'ok' as const, clearedKeys: 4 }));
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
      storage: { reset },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['navigation', 'storage'],
      storageSeed: { theme: 'dark' },
    });

    expect(reset).toHaveBeenCalledWith({ theme: 'dark' });
    const storageResult = report.results.find((r) => r.category === 'storage');
    expect(storageResult?.status).toBe('ok');
    expect(report.unsupported).toEqual([]);
  });

  it("reports storage 'unsupported' (never throws) when the storage facade returns unsupported", async () => {
    const reset = vi.fn(async () => ({ status: 'unsupported' as const }));
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
      storage: { reset },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['storage'],
    });

    expect(reset).toHaveBeenCalled();
    expect(report.results[0]?.status).toBe('unsupported');
    expect(report.unsupported).toEqual(['storage']);
  });

  it('routes storage-backed auth/localDb categories through the storage reset facade', async () => {
    const reset = vi.fn(async () => ({ status: 'ok' as const }));
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
      storage: { reset },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['authTokens', 'secureStorage', 'localDb'],
      storageSeed: { signedIn: false },
    });

    expect(reset).toHaveBeenNthCalledWith(1, {
      __fliwrightResetCategory: 'authTokens',
      seed: { signedIn: false },
    });
    expect(reset).toHaveBeenNthCalledWith(2, {
      __fliwrightResetCategory: 'secureStorage',
      seed: { signedIn: false },
    });
    expect(reset).toHaveBeenNthCalledWith(3, {
      __fliwrightResetCategory: 'localDb',
      seed: { signedIn: false },
    });
    expect(report.results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok']);
    expect(report.unsupported).toEqual([]);
  });

  it('reports storage-backed categories unsupported when no storage facade exists', async () => {
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['authTokens', 'secureStorage', 'localDb'],
    });

    expect(report.unsupported).toEqual(['authTokens', 'secureStorage', 'localDb']);
  });

  it('routes app-capability reset categories through fliwright.reset', async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
      app: {
        hasCapability: vi.fn(async (name: string) => name === 'fliwright.reset'),
        invoke,
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['webview', 'timers', 'isolates', 'permissions'],
    }, { full: true });

    expect(invoke).toHaveBeenNthCalledWith(1, 'fliwright.reset', 'reset', { category: 'webview', full: true });
    expect(invoke).toHaveBeenNthCalledWith(2, 'fliwright.reset', 'reset', { category: 'timers', full: true });
    expect(invoke).toHaveBeenNthCalledWith(3, 'fliwright.reset', 'reset', { category: 'isolates', full: true });
    expect(invoke).toHaveBeenNthCalledWith(4, 'fliwright.reset', 'reset', { category: 'permissions', full: true });
    expect(report.results.map((result) => result.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(report.unsupported).toEqual([]);
  });

  it('reports app-capability reset categories unsupported when fliwright.reset is absent', async () => {
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
      app: {
        listCapabilities: vi.fn(async () => [{ name: 'other', methods: ['reset'] }]),
        invoke: vi.fn(async () => {}),
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['webview', 'permissions'],
    });

    expect(driver.app.invoke).not.toHaveBeenCalled();
    expect(report.unsupported).toEqual(['webview', 'permissions']);
  });

  it('applies riverpod overrides through the driver state adapter', async () => {
    const override = vi.fn(async () => {});
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
      state: { override },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['riverpod'],
      riverpodOverrides: [
        { provider: 'cartProvider', value: [] },
        { key: 'authStateProvider', value: { signedIn: false } },
      ],
    });

    expect(override).toHaveBeenCalledWith('cartProvider', []);
    expect(override).toHaveBeenCalledWith('authStateProvider', { signedIn: false });
    expect(report.results[0]).toMatchObject({ category: 'riverpod', status: 'ok' });
    expect(report.unsupported).toEqual([]);
  });

  it('skips riverpod reset when no overrides are declared', async () => {
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['riverpod'],
    });

    expect(report.results[0]).toMatchObject({ category: 'riverpod', status: 'skipped' });
    expect(report.unsupported).toEqual([]);
  });

  it('reports riverpod unsupported when overrides are declared but no state adapter exists', async () => {
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['riverpod'],
      riverpodOverrides: [{ provider: 'cartProvider', value: [] }],
    });

    expect(report.results[0]).toMatchObject({ category: 'riverpod', status: 'unsupported' });
    expect(report.unsupported).toEqual(['riverpod']);
  });

  it('loads mock rules and switches every endpoint that supports the requested mockProfile', async () => {
    const loadRules = vi.fn(async () => {});
    const switchRule = vi.fn(async () => {});
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
        loadRules,
        listRules: vi.fn(() => [
          { endpoint: '/api/a', method: 'GET', rules: ['success', 'empty'], activeRule: 'success' },
          { endpoint: '/api/b', method: 'POST', rules: ['success'], activeRule: 'success' },
          { endpoint: '/api/c', method: 'GET', rules: ['empty'], activeRule: 'success' },
        ]),
        switchRule,
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['mock'],
      mockProfile: 'empty',
      mockDir: '/repo/.fliwright/mocks',
    });

    expect(driver.mock.clear).toHaveBeenCalled();
    expect(driver.mock.clearCalls).toHaveBeenCalled();
    expect(loadRules).toHaveBeenCalledWith('/repo/.fliwright/mocks');
    expect(switchRule).toHaveBeenCalledWith('/api/a', 'empty', 'GET');
    expect(switchRule).toHaveBeenCalledWith('/api/c', 'empty', 'GET');
    expect(switchRule).toHaveBeenCalledTimes(2);
    expect(report.results[0]).toMatchObject({ category: 'mock', status: 'ok' });
    expect(report.unsupported).toEqual([]);
  });

  it('reports mock unsupported when mockProfile is declared but no matching rule exists', async () => {
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
        loadRules: vi.fn(async () => {}),
        listRules: vi.fn(() => [
          { endpoint: '/api/a', method: 'GET', rules: ['success'], activeRule: 'success' },
        ]),
        switchRule: vi.fn(async () => {}),
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['mock'],
      mockProfile: 'empty',
    });

    expect(report.results[0]).toMatchObject({ category: 'mock', status: 'unsupported' });
    expect(report.unsupported).toEqual(['mock']);
    expect(driver.mock.switchRule).not.toHaveBeenCalled();
  });

  it('reports mock unsupported when mockProfile is declared but the adapter lacks rule APIs', async () => {
    const driver = {
      page: { resetToHome: vi.fn(async () => {}) },
      mock: {
        clear: vi.fn(async () => {}),
        clearCalls: vi.fn(async () => {}),
      },
    };
    const manager = new BaselineManager(driver);

    const report = await manager.reset({
      homeRoute: '/home',
      resetCategories: ['mock'],
      mockProfile: 'empty',
    });

    expect(report.results[0]).toMatchObject({ category: 'mock', status: 'unsupported' });
    expect(report.unsupported).toEqual(['mock']);
  });
});
