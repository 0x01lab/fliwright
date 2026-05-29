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
}

export interface HealingResult {
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  matchedWidget: WidgetInfo;
}

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delay?: number;
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
