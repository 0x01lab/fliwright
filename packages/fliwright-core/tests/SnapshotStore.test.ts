import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotStore } from '../src/SnapshotStore.js';
import type { WidgetSnapshot } from '../src/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fliwright-snapshot-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SnapshotStore', () => {
  it('load returns null when no snapshot exists', () => {
    const store = new SnapshotStore(tmpDir);
    const result = store.load('my test', 'text=Login');
    expect(result).toBeNull();
  });

  it('save and load round-trips a snapshot', async () => {
    const store = new SnapshotStore(tmpDir);
    const snapshot: WidgetSnapshot = {
      type: 'ElevatedButton',
      parentType: 'Column',
      adjacentText: ['User', 'Pass'],
      rect: { x: 10, y: 20, width: 100, height: 40 },
      callbackNames: ['_onLogin'],
    };
    await store.save('my test', 'text=Login', snapshot);
    const loaded = store.load('my test', 'text=Login');
    expect(loaded).toEqual(snapshot);
  });

  it('save overwrites existing snapshot', async () => {
    const store = new SnapshotStore(tmpDir);
    const v1: WidgetSnapshot = {
      type: 'ElevatedButton',
      parentType: 'Column',
      adjacentText: [],
      rect: { x: 0, y: 0, width: 100, height: 40 },
      callbackNames: [],
    };
    const v2: WidgetSnapshot = {
      type: 'TextButton',
      parentType: 'Row',
      adjacentText: ['Cancel'],
      rect: { x: 0, y: 0, width: 80, height: 30 },
      callbackNames: ['_onSubmit'],
    };
    await store.save('test', 'text=Go', v1);
    await store.save('test', 'text=Go', v2);
    const loaded = store.load('test', 'text=Go');
    expect(loaded!.type).toBe('TextButton');
  });

  it('list returns all snapshots for a test', async () => {
    const store = new SnapshotStore(tmpDir);
    const snap: WidgetSnapshot = {
      type: 'TextButton',
      parentType: 'Column',
      adjacentText: [],
      rect: { x: 0, y: 0, width: 100, height: 40 },
      callbackNames: [],
    };
    await store.save('login test', 'text=Login', snap);
    await store.save('login test', 'text=Submit', snap);
    const all = store.list('login test');
    expect(all.size).toBe(2);
    expect(all.has('text=Login')).toBe(true);
    expect(all.has('text=Submit')).toBe(true);
  });

  it('list returns empty map for unknown test', () => {
    const store = new SnapshotStore(tmpDir);
    const all = store.list('unknown');
    expect(all.size).toBe(0);
  });
});
