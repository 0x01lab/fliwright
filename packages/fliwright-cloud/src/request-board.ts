import type { TestRequest } from '@fliwright/cloud-protocol';

export const boardColumns = [
  'pending',
  'running',
  'passed',
  'failed',
  'other',
] as const;
export type TestColumn = (typeof boardColumns)[number];
export const boardBatch = 16;
export type BoardDepth = Record<TestColumn, number>;
export type BoardItem = Omit<TestRequest, 'target'> & {
  repository?: string;
  projectName?: string;
};
export interface BoardSnapshot {
  items: BoardItem[];
  totals: BoardDepth;
  queue: string[];
}
