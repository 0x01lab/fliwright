import type { WidgetSnapshot } from './types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

interface SnapshotFile {
  testName: string;
  selector: string;
  snapshot: WidgetSnapshot;
  firstSeen: string;
  lastUpdated: string;
}

export class SnapshotStore {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), '.fliwright', 'snapshots');
  }

  load(testName: string, selector: string): WidgetSnapshot | null {
    const filePath = this.filePath(testName, selector);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data: SnapshotFile = JSON.parse(raw);
      return data.snapshot;
    } catch {
      return null;
    }
  }

  async save(testName: string, selector: string, snapshot: WidgetSnapshot): Promise<void> {
    const filePath = this.filePath(testName, selector);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Preserve firstSeen if file already exists
    let firstSeen = new Date().toISOString();
    try {
      const existing = fs.readFileSync(filePath, 'utf-8');
      const data: SnapshotFile = JSON.parse(existing);
      if (data.firstSeen) {
        firstSeen = data.firstSeen;
      }
    } catch {
      // File doesn't exist yet, use new timestamp.
    }

    const data: SnapshotFile = {
      testName,
      selector,
      snapshot,
      firstSeen,
      lastUpdated: new Date().toISOString(),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  list(testName: string): Map<string, WidgetSnapshot> {
    const dir = path.join(this.baseDir, sanitize(testName));
    const result = new Map<string, WidgetSnapshot>();
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
          const data: SnapshotFile = JSON.parse(raw);
          result.set(data.selector, data.snapshot);
        } catch {
          // Skip malformed files.
        }
      }
    } catch {
      // Directory doesn't exist yet.
    }
    return result;
  }

  private filePath(testName: string, selector: string): string {
    return path.join(
      this.baseDir,
      sanitize(testName),
      encodeURIComponent(selector) + '.json',
    );
  }
}
