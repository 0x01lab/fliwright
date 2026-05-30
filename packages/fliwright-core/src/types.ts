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
}
