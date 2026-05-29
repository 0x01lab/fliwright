import type { MockResponse } from '../types.js';

export interface MockAdapter {
  addRoute(pattern: string, handler: MockResponse): Promise<void>;
  removeRoute(pattern: string): Promise<void>;
  clear(): Promise<void>;
}
