// packages/fliwright-vscode/src/editor/types.ts

/** @fliwright-step 注解的 JSON 结构 */
export interface StepAnnotation {
  name: string;
  screenshot?: string;
  status?: 'pass' | 'fail' | 'pending';
  error?: string;
  /** 原子操作聚合的时间范围（毫秒） */
  duration?: number;
}

/** 原子操作（单条 locator 调用） */
export interface AtomicStep {
  /** 在源文件中的行号（0-based） */
  line: number;
  action: 'click' | 'tap' | 'fill' | 'scroll' | 'drag' | 'type' | 'waitFor' | 'assert';
  selector: string;
  argument?: string;
  status: 'pass' | 'fail' | 'pending';
  warning?: string;
}

/** 语义步骤（可展开为一组 AtomicStep） */
export interface StepModel {
  /** 注解 JSON */
  annotation: StepAnnotation;
  /** 注解注释在源文件中的行号（0-based） */
  annotationLine: number;
  /** 该步骤的原子操作 */
  atoms: AtomicStep[];
  /** 注解行到下一个注解行之间的源代码文本 */
  sourceCode: string;
  /** 源代码的起始行（0-based） */
  sourceStartLine: number;
  /** 源代码的结束行（exclusive） */
  sourceEndLine: number;
}

/** 解析结果 */
export interface ParseResult {
  steps: StepModel[];
  errors: ParseError[];
  /** 测试函数名 */
  testName?: string;
}

/** 注解解析错误 */
export interface ParseError {
  line: number;
  message: string;
}

/** Extension → Webview 消息类型 */
export type ExtToWebview =
  | { type: 'init'; steps: StepModel[]; code: string; testName?: string }
  | { type: 'step-updated'; index: number; step: StepModel }
  | { type: 'step-added'; step: StepModel }
  | { type: 'run-status'; stepIndex: number; status: 'pass' | 'fail'; error?: string }
  | { type: 'live-mode'; active: boolean }
  | { type: 'navigate-to-failure'; stepIndex: number };

/** Webview → Extension 消息类型 */
export type WebviewToExt =
  | { type: 'select-step'; index: number }
  | { type: 'toggle-expand'; index: number }
  | { type: 'edit-step-name'; index: number; name: string }
  | { type: 'delete-step'; index: number }
  | { type: 'edit-code'; code: string }
  | { type: 'apply-healing'; stepIndex: number; healedSelector: string }
  | { type: 'run-test' }
  | { type: 'open-source' };