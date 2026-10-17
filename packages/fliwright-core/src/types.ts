import type { AiRuntime } from './ai/AiRuntime.js';

/** Function signature for sending VM Service JSON-RPC requests. */
export type SendRequest = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export type TextMatchMode = 'exact' | 'contains' | 'regex';

export interface IconSelector {
  codePoint: number;
  fontFamily?: string;
  fontPackage?: string;
}

export interface FilterCriteria {
  hasText?: string;
  hasTextContains?: string;
  hasTextRegex?: string;
  visible?: boolean;
  enabled?: boolean;
  checked?: boolean;
}

export interface MatchCriteria {
  type?: string;
  key?: string;
  id?: string;
  name?: string;
  ancestorKey?: string;
  text?: string;
  textContains?: string;
  textRegex?: string;
  semanticIdentifier?: string;
  semanticsLabel?: string;
  semanticsHint?: string;
  role?: string;
  tooltip?: string;
  enabled?: boolean;
  checked?: boolean;
  subtype?: string;
  iconCodePoint?: number;
  iconFontFamily?: string;
  iconFontPackage?: string;
}

export interface FallbackCriteria {
  semanticsLabel?: string;
  semanticsHint?: string;
  hintText?: string;
  textContains?: string;
}

export interface PositionFilter {
  nth?: number;
  first?: boolean;
  last?: boolean;
  visible?: boolean;
}

export interface SelectorQuery {
  match?: MatchCriteria;
  within?: SelectorQuery;
  fallback?: FallbackCriteria;
  position?: PositionFilter;
  and?: SelectorQuery[];
  or?: SelectorQuery[];
  filter?: FilterCriteria;
  containing?: SelectorQuery;
}

export type SelectorAst =
  | {
      kind: 'text';
      value: string;
      match?: TextMatchMode;
      caseSensitive?: boolean;
    }
  | { kind: 'key'; value: string }
  | { kind: 'type'; value: string }
  | { kind: 'subtype'; value: string }
  | { kind: 'id'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'ancestorKey'; value: string }
  | {
      kind: 'semantics';
      identifier?: string;
      label?: string;
      hint?: string;
      role?: string;
      match?: TextMatchMode;
      caseSensitive?: boolean;
    }
  | { kind: 'icon'; codePoint: number; fontFamily?: string; fontPackage?: string }
  | { kind: 'tooltip'; value: string }
  | { kind: 'descendant'; of: SelectorAst; matching: SelectorAst; matchRoot?: boolean }
  | { kind: 'ancestor'; of: SelectorAst; matching: SelectorAst; matchRoot?: boolean }
  | { kind: 'and'; selectors: SelectorAst[] }
  | { kind: 'or'; selectors: SelectorAst[] }
  | { kind: 'nth'; selector: SelectorAst; index: number }
  | { kind: 'last'; selector: SelectorAst }
  | { kind: 'filter'; selector: SelectorAst; filter: FilterCriteria }
  | { kind: 'containing'; parent: SelectorAst; descendant: SelectorAst };

export type SelectorInput =
  | string
  | RegExp
  | SelectorQuery
  | SelectorAst
  | { text: string | RegExp; match?: TextMatchMode; exact?: boolean; caseSensitive?: boolean; ancestor?: SelectorInput }
  | { key: string; ancestor?: SelectorInput }
  | { type: string; enabled?: boolean; checked?: boolean; ancestor?: SelectorInput }
  | { id: string; ancestor?: SelectorInput }
  | { name: string; ancestor?: SelectorInput }
  | { ancestorKey: string; ancestor?: SelectorInput }
  | { subtype: string; ancestor?: SelectorInput }
  | {
      semantics: {
        identifier?: string;
        label?: string;
        hint?: string;
        role?: string;
        match?: TextMatchMode;
        caseSensitive?: boolean;
      };
      ancestor?: SelectorInput;
    }
  | { icon: IconSelector; ancestor?: SelectorInput }
  | { tooltip: string; ancestor?: SelectorInput };

export interface ProviderInfo {
  name: string;
  key?: string;
  type?: string;
  value: unknown;
  readable?: boolean;
  overridable?: boolean;
  watching?: boolean;
  error?: string;
}

export interface KeyedAncestor {
  key: string;
  type: string;
}

export interface WidgetInfo {
  id: string;
  type: string;
  text?: string;
  key?: string;
  name?: string;
  ancestorKey?: string;
  semanticsId?: string;
  semanticsLabel?: string;
  semanticsHint?: string;
  role?: string;
  rect?: { x: number; y: number; width: number; height: number };
  hitTestable?: boolean;
  properties: Record<string, unknown>;
  tooltip?: string;
  descendantText?: string;
  descendantIcon?: { codePoint: number; fontFamily?: string; fontPackage?: string };
  keyedAncestors?: KeyedAncestor[];
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

export interface AgentSnapshotRef {
  ref: string;
  role: 'button' | 'textbox' | 'checkbox' | 'link' | 'heading' | 'image' | 'text' | string;
  label: string;
  type: string;
  key?: string;
  selector?: string;
  enabled?: boolean;
  textField?: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  properties?: Record<string, unknown>;
}

export interface AgentSnapshotResult {
  snapshot: string;
  groupId: string;
  refs: AgentSnapshotRef[];
  count: number;
  error?: string;
}

export interface AgentSnapshotOptions {
  depth?: number;
  includeRects?: boolean;
  includeProperties?: boolean;
}

export interface AgentFindQuery {
  text?: string;
  containsText?: string;
  key?: string;
  semanticsLabel?: string;
  role?: string;
  type?: string;
}

export interface RefTarget {
  ref: string;
}

export interface HealingResult {
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  matchedWidget: WidgetInfo;
}

export interface ResolvedSelector {
  query: SelectorQuery;
  ambiguous: boolean;
  matchCount: number;
  stability?: RecordingSelectorStability;
}

export type RecordingSelectorStability = 'key' | 'semantics' | 'label' | 'ancestor' | 'positional';

export interface RecordingSelectorCandidate {
  query: SelectorQuery;
  matchCount: number;
  matchesTarget: boolean;
  stability: RecordingSelectorStability;
}

export interface RecordedTarget extends Partial<WidgetInfo> {
  targetId: string;
  status: 'resolved' | 'unresolved';
  candidates: RecordingSelectorCandidate[];
  issue?: string;
  route?: string | null;
  ancestorPath?: { type: string; key?: string }[];
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
  url?: string;
  headers: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: string;
  status?: number;
  response?: unknown;
  timestamp: string;
  backend?: 'flutter' | 'dio' | 'tool-server' | string;
}

export interface BridgeContext {
  route?: {
    location?: string;
    name?: string;
  };
  focused?: {
    ref?: string;
    role?: string;
    label?: string;
    type?: string;
    key?: string;
  };
  keyboard?: SoftKeyboardState;
  diagnostics?: Record<string, unknown>;
  capabilities?: Record<string, boolean>;
}

export interface SoftKeyboardState {
  visible: boolean;
  insetBottom: number;
}

export interface FrameCaptureResult {
  success?: boolean;
  frameId: string;
  capturedAt: string;
  route?: {
    location?: string;
    name?: string;
  };
  screenshot?: {
    format: 'png' | string;
    base64: string;
  };
  snap?: AgentSnapshotResult;
  snapshot?: unknown;
  diagnostics?: Record<string, unknown>;
}

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  name?: string;
}

export interface SourceMapNode {
  id?: string;
  type: string;
  label?: string;
  text?: string;
  key?: string;
  role?: string;
  rect?: { x: number; y: number; width: number; height: number };
  source?: SourceLocation;
  properties?: Record<string, unknown>;
}

export interface SourceMapResult {
  success?: boolean;
  error?: string;
  widgetCreationTracked: boolean;
  route?: {
    location?: string;
    name?: string;
  };
  nodes: SourceMapNode[];
  candidateFiles: string[];
  fileCounts?: Record<string, number>;
  count: number;
}

export interface SourceMapOptions {
  includeFramework?: boolean;
  includeRects?: boolean;
  includeProperties?: boolean;
  limit?: number;
}

export interface BridgeQuery {
  key?: string;
  text?: string;
  containsText?: string;
  type?: string;
  semanticsLabel?: string;
  semanticsIdentifier?: string;
  role?: string;
  ref?: string;
}

export interface BridgeQueryMatch {
  ref?: string;
  role?: string;
  label?: string;
  text?: string;
  value?: unknown;
  type?: string;
  key?: string;
  rect?: { x: number; y: number; width: number; height: number };
  enabled?: boolean;
  visible?: boolean;
  hitTestable?: boolean;
  actionable?: boolean;
  checked?: boolean;
  selected?: boolean;
  properties?: Record<string, unknown>;
}

export interface BridgeQueryResult {
  matches: BridgeQueryMatch[];
  count: number;
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
  streamId?: string;
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
  type: 'pointerEvent' | 'textInput' | 'focus' | 'route';
  focused?: boolean;
  route?: string;
  kind?: 'down' | 'move' | 'up' | 'cancel';
  pointer?: number;
  position?: { x: number; y: number };
  timestamp: number;
  buttons?: number;
  text?: string;
  /** The text is a mask; replay must supply a value through an input parameter. */
  sensitive?: true;
  action?: 'replace';
  version?: 2;
  sessionId?: string;
  sequence?: number;
  elapsedUs?: number;
  frameId?: string;
  targetId?: string;
  focusSessionId?: string;
  viewport?: { width: number; height: number; pixelRatio: number };
  target?: RecordedTarget;
}

export interface RecordedOperation {
  kind: 'tap' | 'longPress' | 'drag' | 'type';
  position: { x: number; y: number };
  delta?: { x: number; y: number };
  text?: string;
  /** The text is a mask; replay must supply a value through an input parameter. */
  sensitive?: true;
  action?: 'replace';
  /** Focus session used to coalesce IME updates into one final fill value. */
  focusSessionId?: string;
  duration?: number;
  /** Long-press hold or drag pointer-down to pointer-up duration in milliseconds. */
  durationMs?: number;
  timestamp: number;
  status?: 'included' | 'ignored';
  ignoreReason?: 'duplicate' | 'mergedIntoType' | 'nonActionable' | 'duringTransition' | 'noEffect';
  confidence?: number;
  /** Widget information frozen by the bridge before pointer dispatch. */
  recordedTarget?: RecordedTarget;
}

export interface RecordingScreenshot {
  /** Relative to the recording artifact directory; binary data stays on disk. */
  path: string;
  byteLength: number;
  format: 'png';
  width?: number;
  height?: number;
  pixelRatio?: number;
}

export interface RecordingFrame {
  id: string;
  index: number;
  kind: RecordedOperation['kind'] | 'pending';
  status: 'capturing' | 'ready' | 'error';
  timestamp: number;
  pointer?: number;
  operationIndex?: number;
  position: { x: number; y: number };
  delta?: { x: number; y: number };
  text?: string;
  /** The text is a mask; replay must supply a value through an input parameter. */
  sensitive?: true;
  action?: 'replace';
  duration?: number;
  durationMs?: number;
  selector?: string;
  operationStatus?: RecordedOperation['status'];
  ignoreReason?: RecordedOperation['ignoreReason'];
  confidence?: number;
  screenshot?: RecordingScreenshot;
  screenshotError?: string;
  synthetic?: boolean;
}

export interface CodegenOptions {
  checkpoints?: readonly import('./RecordingCheckpoints.js').RecordingCheckpointCandidate[];
  testName?: string;
  imports?: string;
  lang?: 'ts' | 'dart';
  /** Package URI of an app-owned main() compatible with IntegrationTestWidgetsFlutterBinding. */
  dartAppEntrypoint?: string;
  resetToHomeBeforeEach?: boolean;
  homeRoute?: string;
  timeline?: boolean;
  mode?: 'script' | 'test';
  /** Named environment applied before a generated regression test. */
  scenarioName?: string;
  recordingFrames?: readonly RecordingFrame[];
  assertionSuggestions?: readonly AssertionSuggestion[];
}

export interface AssertionSuggestion {
  afterIndex: number;
  targetOperationIndex?: number;
  reason: string;
  template: string;
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
  ref?: string;
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
  /** Pick a specific index from PRESET_SKILL/LLM_GENERATE `data` arrays. When omitted, cycles automatically. */
  dataIndex?: number;
  /** Optional AI runtime used by form-rule data DSL entries such as `ai:...` or `{ "prompt": "..." }`. */
  aiRuntime?: AiRuntime;
  /** Optional custom action scripts used by form-rule `action.script` entries. */
  actionScripts?: Record<string, FormActionScript>;
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

export type FormDataScenarioValue = FormRuleDataEntry;

export interface FormDataScenario {
  name?: string;
  description?: string;
  note?: string;
  values: Record<string, FormDataScenarioValue>;
}

export interface FormSkill {
  name: string;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  find?: SelectorQuery;
  action?: FormRuleAction;
  match: (field: FormFieldMeta) => boolean;
  generate: (field: FormFieldMeta, locale: string, options?: FormHelperOptions) => string | Promise<string>;
}

export interface FormRuleAction {
  script: string;
  args?: Record<string, unknown>;
}

export interface FormActionLocator {
  click(options?: unknown): Promise<void>;
  fill(text: string, options?: unknown): Promise<void>;
  type(text: string, options?: unknown): Promise<void>;
  selectOption(value: string | number, options?: unknown): Promise<void>;
  scrollIntoView(options?: unknown): Promise<void>;
}

export interface FormActionScriptContext {
  field: FormFieldMeta;
  value: string;
  action: FormRuleAction;
  fieldSelector: SelectorQuery;
  option?: FormFieldOption;
  sendRequest: SendRequest;
  locator: (selector: SelectorInput) => FormActionLocator;
}

export type FormActionScript = (context: FormActionScriptContext) => void | Promise<void>;

export interface FormRule {
  find?: SelectorQuery;
  match?: Record<string, string>;
  type: 'PRESET_SKILL' | 'REGEXP_MOCK' | 'LLM_GENERATE';
  dataKey?: string;
  data?: FormRuleDataEntry[];
  pattern?: string;
  action?: FormRuleAction;
}

export interface FormRulesFile {
  version: number;
  locale?: string;
  formData?: FormDataScenario[];
  rules: FormRule[];
}

/** A named mock rule definition within an endpoint config file. */
export interface MockRuleBase {
  status?: number;
  delay?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/** A named mock rule definition within an endpoint config file. */
export interface MockRule extends MockRuleBase {
  name: string;
  status: number;
}

/** A named mock rule override that can inherit response fields from baseRule. */
export interface MockRuleOverride extends MockRuleBase {
  name: string;
  description?: string;
  removeBodyFields?: string[];
}

/** Parsed structure of a .fliwright/mocks/api/*.json endpoint config file. */
export interface MockEndpointConfig {
  version: number;
  name: string;
  description?: string;
  method: string;
  endpoint: string;
  baseRule?: MockRuleBase;
  rules: MockRuleOverride[];
}

/** Endpoint config after baseRule inheritance has been expanded. */
export interface NormalizedMockEndpointConfig extends Omit<MockEndpointConfig, 'rules'> {
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
