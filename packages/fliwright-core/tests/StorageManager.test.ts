import { describe, expect, it, vi } from 'vitest';
import { StorageManager } from '../src/StorageManager.js';

describe('StorageManager', () => {
  it('reports ok with counts when the bridge returns success', async () => {
    const sendRequest = vi.fn(async () => ({
      success: true,
      action: 'storage.reset',
      clearedKeys: 5,
      seededKeys: 2,
    }));
    const manager = new StorageManager(sendRequest);

    const result = await manager.reset({ theme: 'dark' });

    expect(result.status).toBe('ok');
    expect(result.clearedKeys).toBe(5);
    expect(result.seededKeys).toBe(2);
    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.storage.reset', {
      seed: '{"theme":"dark"}',
    });
  });

  it('degrades to unsupported when the bridge reports unsupported', async () => {
    const sendRequest = vi.fn(async () => ({
      success: false,
      code: 'unsupported',
      message: 'no host handler',
    }));
    const manager = new StorageManager(sendRequest);

    const result = await manager.reset();

    expect(result.status).toBe('unsupported');
    expect(result.message).toBe('no host handler');
  });

  it('degrades to unsupported when the extension is absent (sendRequest rejects)', async () => {
    const sendRequest = vi.fn(async () => {
      throw new Error('Extension "ext.fliwright.storage.reset" is not registered');
    });
    const manager = new StorageManager(sendRequest);

    const result = await manager.reset();

    expect(result.status).toBe('unsupported');
    expect(result.message).toContain('not available');
  });

  it('serializes the seed as a JSON object string', async () => {
    const sendRequest = vi.fn(async () => ({ success: true }));
    const manager = new StorageManager(sendRequest);

    await manager.reset({ count: 3, nested: { a: 1 }, list: [1, 2] });

    expect(sendRequest).toHaveBeenCalledWith('ext.fliwright.storage.reset', {
      seed: '{"count":3,"nested":{"a":1},"list":[1,2]}',
    });
  });
});
