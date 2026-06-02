/** Function signature for sending VM Service JSON-RPC requests. */
export type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export type SelectorInput =
  | string
  | { text: string; ancestor?: SelectorInput }
  | { key: string; ancestor?: SelectorInput }
  | { type: string; ancestor?: SelectorInput };

export interface ProviderInfo {
  name: string;
  type: string;
  value: unknown;
}

export interface WidgetInfo {
  id: string;
  type: string;
  text?: string;
  key?: string;
  rect: { x: number; y: number; width: number; height: number };
  properties: Record<string, unknown>;
}

export interface WidgetSnapshot {
  type: string;
  text?: string;
  key?: string;
  parentType: string;
  adjacentText: string[];
  rect: { x: number; y: number; width: number; height: number };
  callbackNames: string[];
  description?: string;
  firstSeen?: string;
}

export interface HealingResult {
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  matchedWidget: WidgetInfo;
}

export interface HealingReport {
  testName: string;
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  scores: {
    position: number;
    context: number;
    codeBinding: number;
    text: number;
    weighted: number;
  };
  originalSnapshot: WidgetSnapshot;
  matchedWidget: WidgetInfo;
  timestamp: string;
}

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
}

export interface MockRouteResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
}

export interface MockRouteConfig {
  id?: string;
  method?: string;
  path: string;
  response: MockRouteResponse;
}

export interface MockCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  timestamp: string;
}

export interface WidgetMatch {
  widget: WidgetInfo;
  score: number;
}

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface VMServiceEvent {
  kind: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface ProtocolMessage {
  jsonrpc: '2.0';
  id?: string;
  method: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface FailureContext {
  assertion: {
    matcher: string;
    expected: string;
    actual: string;
    timeout: number;
  };
  screenshot: Buffer | null;
  widgetTree: object;
  source: {
    file: string;
    line: number;
    snippet: string;
  };
  timestamp: string;
}

export interface RawInputEvent {
  type: 'pointerEvent' | 'textInput';
  kind?: 'down' | 'move' | 'up';
  pointer?: number;
  position?: { x: number; y: number };
  timestamp: number;
  buttons?: number;
  text?: string;
  action?: 'replace';
}

export interface RecordedOperation {
  kind: 'tap' | 'longPress' | 'drag' | 'type';
  position: { x: number; y: number };
  delta?: { x: number; y: number };
  text?: string;
  action?: 'replace';
  duration?: number;
  timestamp: number;
}

export interface CodegenOptions {
  testName?: string;
  imports?: string;
  lang?: 'ts' | 'dart';
}

export interface FormFieldMeta {
  id: string;
  type: string;
  controlType?: FormControlType;
  rect: { x: number; y: number; width: number; height: number };
  key?: string;
  ancestorKey?: string;
  name?: string;
  semanticsId?: string;
  semanticsLabel?: string;
  semanticsHint?: string;
  role?: string;
  hintText?: string;
  label?: string;
  keyboardType?: string;
  maxLength?: number;
  obscureText: boolean;
  enabled: boolean;
  value?: unknown;
  options?: FormFieldOption[];
  selector: string;
}

export type FormControlType = 'textInput' | 'select' | 'radio' | 'checkbox';

export interface FormFieldOption {
  label: string;
  value?: string;
  semanticsId?: string;
  selected?: boolean;
  enabled?: boolean;
}

export type SemanticType =
  | 'phone' | 'email' | 'idCard' | 'fullName' | 'address'
  | 'password' | 'captcha' | 'number' | 'text' | 'url' | 'date'
  | 'boolean' | 'option';

export interface FormFillResult {
  filled: number;
  skipped: number;
  errors: Array<{ fieldId: string; error: string }>;
  fields: Array<{
    id: string;
    semanticType: SemanticType;
    generatedValue: string;
    selector: string;
    controlType?: FormControlType;
    options?: FormFieldOption[];
    status: 'filled' | 'skipped' | 'error';
    reason?: string;
    key?: string;
    ancestorKey?: string;
    name?: string;
    semanticsId?: string;
    semanticsLabel?: string;
    semanticsHint?: string;
    role?: string;
  }>;
}

export interface FormAnalyzeResult {
  fields: Array<{
    id: string;
    semanticType: SemanticType;
    generatedValue: string;
    selector: string;
    controlType?: FormControlType;
    options?: FormFieldOption[];
    hintText?: string;
    label?: string;
    key?: string;
    ancestorKey?: string;
    name?: string;
    semanticsId?: string;
    semanticsLabel?: string;
    semanticsHint?: string;
    role?: string;
  }>;
}

export interface FormHelperOptions {
  rulesFile?: string;
  rulesDir?: string;
  locale?: string;
  skipObscureFields?: boolean;
  scope?: string;
  requireRuleMatch?: boolean;
}

export interface FormSkill {
  name: string;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  match: (field: FormFieldMeta) => boolean;
  generate: (field: FormFieldMeta, locale: string) => string;
}

export interface FormRule {
  match: Record<string, string>;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  data?: string[];
  pattern?: string;
}

export interface FormRulesFile {
  version: number;
  locale?: string;
  rules: FormRule[];
}

/** A named mock rule definition within an endpoint config file. */
export interface MockRule {
  name: string;
  status: number;
  delay?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Parsed structure of a .fliwright/mocks/api/*.json endpoint config file. */
export interface MockEndpointConfig {
  version: number;
  name: string;
  description?: string;
  method: string;
  endpoint: string;
  rules: MockRule[];
}

/** Parsed structure of a .fliwright/mocks/mock-index.json file. */
export interface MockIndex {
  version: number;
  defaultRule: string;
  files: string[];
}

/** In-memory entry tracking one endpoint's rules and active selection. */
export interface MockRuleEntry {
  endpoint: string;
  method: string;
  rules: Map<string, MockRule>;
  activeRule: string;
}
