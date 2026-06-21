import type * as vscode from 'vscode';

export type TestNodeStatus = 'passed' | 'failed' | 'unknown';

export interface TestFileNode {
  kind: 'testFile';
  uri: vscode.Uri;
  relPath: string;            // workspace-relative, used in node ids
  label: string;
  status: TestNodeStatus;
  ranAt?: number;
}

export interface TestGroupNode {
  kind: 'testGroup';
  id: string;                 // "<relPath>::<ancestor titles joined by '/'>/<title>"
  label: string;
  status: TestNodeStatus;
}

export interface TestCaseNode {
  kind: 'testCase';
  id: string;                 // "<relPath>::<ancestor titles joined by '/'>/<title>"
  label: string;
  status: TestNodeStatus;
  durationMs?: number;
  fileUri: vscode.Uri;
}

export interface TestStepNode {
  kind: 'testStep';
  label: string;
  status: 'passed' | 'failed' | 'pending';
  fileUri: vscode.Uri;
  stepIndex: number;
}

export interface EmptyNode {
  kind: 'empty';
  label: string;
}

export type TestTreeNode =
  | TestFileNode | TestGroupNode | TestCaseNode | TestStepNode | EmptyNode;

/** Build the stable id for a test/group from its ancestor chain. */
export function testNodeId(relPath: string, ancestorTitles: string[], title: string): string {
  const chain = [...ancestorTitles, title].map((t) => t).join('/');
  return `${relPath}::${chain}`;
}

/** Status used as the aggregate of children. */
export function aggregateStatus(statuses: TestNodeStatus[]): TestNodeStatus {
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('passed')) return 'passed';
  return 'unknown';
}
