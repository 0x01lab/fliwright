import type * as vscode from 'vscode';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ExtensionConfig {
  mockDir: string;
  mockIndex: string;
  vmServiceUrl: string | null;
  autoDiscoverVmService: boolean;
  formRulesDir: string;
  formRulesFile: string | null;
  formLocale: string;
  formPreviewBeforeFill: boolean;
}

export interface MockIndexFile {
  version: 1;
  defaultRule?: string;
  files: string[];
}

export interface MockEndpointFile {
  version: 1;
  name: string;
  description?: string;
  method: HttpMethod;
  endpoint: string;
  rules: MockRule[];
}

export interface MockRule {
  name: string;
  status: number;
  delay?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface MockEndpointEntry {
  kind: 'endpoint';
  uri: vscode.Uri;
  endpointFile: MockEndpointFile;
  indexed: boolean;
  defaultRule?: string;
}

export interface MockRuleEntry {
  kind: 'rule';
  uri: vscode.Uri;
  endpoint: string;
  method: HttpMethod;
  rule: MockRule;
  isDefault: boolean;
  applied?: boolean;
  appliedAt?: number;
}

export interface InvalidFileEntry {
  kind: 'invalid';
  uri: vscode.Uri;
  label: string;
  error: string;
}

export interface MockDiscoveryResult {
  root: vscode.Uri;
  indexUri: vscode.Uri;
  index?: MockIndexFile;
  endpoints: MockEndpointEntry[];
  invalid: InvalidFileEntry[];
}

export interface AppliedMockRule {
  endpoint: string;
  method: HttpMethod;
  ruleName: string;
  filePath: string;
  appliedAt: number;
}

export interface FormRulesFile {
  version: 1;
  locale?: string;
  rules: FormRule[];
}

export interface FormRule {
  match: Record<string, string>;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  data?: string[];
  pattern?: string;
}

export interface FormRulesEntry {
  kind: 'formRulesFile';
  uri: vscode.Uri;
  rulesFile: FormRulesFile;
}

export interface FormRuleEntry {
  kind: 'formRule';
  uri: vscode.Uri;
  rule: FormRule;
  index: number;
}

export interface FormDiscoveryResult {
  root: vscode.Uri;
  files: FormRulesEntry[];
  invalid: InvalidFileEntry[];
}

export interface FormRunSummary {
  action: 'analyze' | 'fill';
  filePath?: string;
  total: number;
  filled?: number;
  skipped?: number;
  errors?: number;
  ranAt: number;
}

export type DeviceConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting'; url: string }
  | { status: 'connected'; url: string; connectedAt: number }
  | { status: 'error'; url?: string; message: string };

export type DeviceTreeNode =
  | { kind: 'deviceStatus'; state: DeviceConnectionState }
  | { kind: 'deviceCapability'; label: string; description: string; available: boolean }
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };

export type MockTreeNode =
  | { kind: 'mockRoot'; label: string; description?: string }
  | MockEndpointEntry
  | MockRuleEntry
  | InvalidFileEntry
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };

export type FormTreeNode =
  | { kind: 'formRoot'; label: string; description?: string }
  | FormRulesEntry
  | FormRuleEntry
  | InvalidFileEntry
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };
