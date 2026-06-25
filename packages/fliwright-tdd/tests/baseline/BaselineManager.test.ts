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
});

