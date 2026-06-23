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
    expect(report.unsupported).toEqual(['storage']);
    expect(report.version).toBe(1);
  });
});
