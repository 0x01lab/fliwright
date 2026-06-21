import type * as vscode from 'vscode';
import type { FormAnalyzeResult, RecordingFrame, SelectorQuery } from '@fliwright/core';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface ExtensionConfig {
  mockDir: string;
  mockIndex: string;
  autoStartMockController: boolean;
  vmServiceUrl: string | null;
  autoDiscoverVmService: boolean;
  testGlob: string;
  runner: 'vitest' | 'cli';
  screenshotMode: 'file' | 'base64' | 'off';
  failureContextDir: string;
  traceDir: string;
  formRulesDir: string;
  formRulesFile: string | null;
  formLocale: string;
  formPreviewBeforeFill: boolean;
  formDebug: boolean;
  formOperationTimeoutMs: number;
  codeLensEnabled: boolean;
  scriptGlob: string;
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
  find?: SelectorQuery;
  match?: Record<string, string>;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  data?: FormRuleDataEntry[];
  pattern?: string;
  action?: FormRuleAction;
}

export type FormRuleDataEntry =
  | string
  | {
      value?: string | string[];
      fixed?: string | string[];
      regex?: string;
      regexp?: string;
      prompt?: string;
      ai?: string;
      fallback?: string;
      system?: string;
      timeoutMs?: number;
      temperature?: number;
    };

export interface FormRuleAction {
  script: string;
  args?: Record<string, unknown>;
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

export interface FormAnalyzeFieldEntry {
  kind: 'formAnalyzeField';
  field: FormAnalyzeResult['fields'][number];
}

export type DeviceConnectionState =
  | { status: 'disconnected' }
  | { status: 'scanning'; label?: string }
  | { status: 'connecting'; url: string }
  | { status: 'connected'; url: string; connectedAt: number }
  | { status: 'recording'; url: string; startedAt: number }
  | { status: 'running'; url?: string; startedAt: number; label: string }
  | { status: 'error'; url?: string; message: string };

export interface TestFileEntry {
  kind: 'testFile';
  uri: vscode.Uri;
  label: string;
  lastResult?: TestCaseResult;
}

export interface ScriptFileEntry {
  kind: 'scriptFile';
  uri: vscode.Uri;
  label: string;
  description?: string;
  lastResult?: RunResult;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface RunResult {
  passed: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  duration: number;
  results: TestCaseResult[];
  stdout?: string;
  stderr?: string;
}

export interface RunEntry {
  kind: 'run';
  id: string;
  label: string;
  filePath?: string;
  result: RunResult;
  ranAt: number;
}

export interface FailureEntry {
  testName: string;
  assertion?: {
    matcher?: string;
    expected?: string;
    actual?: string;
    timeout?: number;
  };
  widgetTree?: unknown;
  source?: {
    file: string;
    line: number;
    snippet?: string;
  };
  healingSuggestion?: {
    originalSelector: string;
    suggestedSelector: string;
    confidence: number;
    scores?: Record<string, number>;
  };
  screenshotPath?: string;
  timestamp: string;
  error?: string;
}

export interface FailureTreeEntry {
  kind: 'failure';
  failure: FailureEntry;
}

export interface RecordingSession {
  status: 'idle' | 'recording' | 'preview';
  startedAt?: number;
  rawEventCount: number;
  operationCount: number;
  frames?: RecordingFrame[];
  generatedCode?: string;
  targetFile?: string;
  testName?: string;
  recordingId?: string;
  recordingDir?: string;
}

export interface StateProviderEntry {
  kind: 'stateProvider';
  key: string;
  value?: unknown;
  type?: string;
  valueType?: string;
  readable?: boolean;
  overridable?: boolean;
  watching?: boolean;
  error?: string;
}

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
  | FormAnalyzeFieldEntry
  | InvalidFileEntry
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };

export interface TestStepEntry {
  kind: 'step';
  label: string;
  status: string;
  stepIndex: number;
  fileUri: vscode.Uri;
}

export type TestTreeNode =
  | TestFileEntry
  | TestStepEntry
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };

export type ScriptTreeNode =
  | ScriptFileEntry
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };

export type RunTreeNode =
  | RunEntry
  | TestCaseResult
  | FailureTreeEntry
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };

export type StateTreeNode =
  | StateProviderEntry
  | { kind: 'stateRoot'; label: string; description?: string }
  | { kind: 'empty'; label: string; description?: string; command?: vscode.Command };
