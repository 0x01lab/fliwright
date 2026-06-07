# Fliwright 可视化测试编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Fliwright VS Code 扩展新增一个基于 Webview 的自定义编辑器 Tab，以时间轴方式展示测试步骤，支持截图预览、断言详情、自愈建议，并整合替代现有 RecordingPanel 和 FailurePanel。

**Architecture:** 编辑器基于 VS Code CustomEditorProvider，解析 TS 测试代码中的 `@fliwright-step` 注解构建步骤模型。左侧步骤时间轴 + 右侧截图预览 + 底部详情 Tab。EditorBridge 桥接录制/运行事件实现只读镜像。

**Tech Stack:** TypeScript, VS Code Extension API (CustomEditorProvider, Webview, TreeDataProvider), 纯 HTML/CSS/JS (Webview 内)

---

## File Structure

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/fliwright-vscode/src/editor/types.ts` | 编辑器共享类型定义（StepModel, AtomicStep, StepResult 等） |
| `packages/fliwright-vscode/src/editor/AnnotationParser.ts` | 解析 TS 代码中的 `@fliwright-step` 注解，输出 StepModel[] |
| `packages/fliwright-vscode/src/editor/AnnotationWriter.ts` | 将编辑器的修改写回 TS 代码（只改注解部分） |
| `packages/fliwright-vscode/src/editor/TestEditorProvider.ts` | VS Code CustomEditorProvider 注册和生命周期 |
| `packages/fliwright-vscode/src/editor/TestEditorPanel.ts` | Webview 创建、HTML 渲染、postMessage 通信 |
| `packages/fliwright-vscode/src/editor/EditorBridge.ts` | 桥接 RecorderService/VitestRunner 事件到编辑器 |
| `packages/fliwright-vscode/src/editor/getHtml.ts` | Webview HTML 生成（纯函数） |
| `packages/fliwright-vscode/tests/AnnotationParser.test.ts` | AnnotationParser 单元测试 |
| `packages/fliwright-vscode/tests/AnnotationWriter.test.ts` | AnnotationWriter 单元测试 |
| `packages/fliwright-vscode/tests/EditorBridge.test.ts` | EditorBridge 单元测试 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `packages/fliwright-vscode/package.json` | 新增 `customEditors` 贡献点 |
| `packages/fliwright-vscode/src/extension.ts` | 注册 TestEditorProvider 和 EditorBridge |
| `packages/fliwright-vscode/src/recording/RecorderService.ts` | 新增 `onStepRecorded` 事件回调 |

---

## Task 1: Editor 类型定义

**Files:**
- Create: `packages/fliwright-vscode/src/editor/types.ts`

- [ ] **Step 1: 创建编辑器共享类型文件**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/fliwright-vscode/src/editor/types.ts
git commit -m "feat(vscode): add visual test editor type definitions"
```

---

## Task 2: AnnotationParser — 测试优先

**Files:**
- Create: `packages/fliwright-vscode/tests/AnnotationParser.test.ts`
- Create: `packages/fliwright-vscode/src/editor/AnnotationParser.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/fliwright-vscode/tests/AnnotationParser.test.ts
import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../src/editor/AnnotationParser';

describe('AnnotationParser', () => {
  const parser = new AnnotationParser();

  it('从 TS 代码中提取 @fliwright-step 注解和步骤', () => {
    const code = `test('购物流程', async ({ page }) => {
  // @fliwright-step: {"name":"填写登录表单"}
  await page.locator({ text: '手机号' }).fill('13800138000');
  await page.locator({ text: '登录' }).click();

  // @fliwright-step: {"name":"浏览商品","screenshot":"snapshots/step-2.png"}
  await page.locator({ text: '商品卡片' }).tap();
});`;

    const result = parser.parse(code);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].annotation.name).toBe('填写登录表单');
    expect(result.steps[0].annotationLine).toBe(1);
    expect(result.steps[0].atoms).toHaveLength(2);
    expect(result.steps[0].atoms[0].action).toBe('fill');
    expect(result.steps[0].atoms[0].selector).toBe("{ text: '手机号' }");
    expect(result.steps[0].sourceCode).toContain("fill('13800138000')");

    expect(result.steps[1].annotation.name).toBe('浏览商品');
    expect(result.steps[1].annotation.screenshot).toBe('snapshots/step-2.png');
    expect(result.steps[1].atoms).toHaveLength(1);
  });

  it('处理无注解的普通文件（返回空数组）', () => {
    const code = `test('hello', async ({ page }) => {
  await page.locator({ text: 'ok' }).click();
});`;

    const result = parser.parse(code);

    expect(result.steps).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('处理损坏的注解 JSON（标记为解析错误）', () => {
    const code = `test('test', async ({ page }) => {
  // @fliwright-step: {invalid json}
  await page.locator({ text: 'ok' }).click();
});`;

    const result = parser.parse(code);

    expect(result.steps).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].line).toBe(1);
    expect(result.errors[0].message).toContain('JSON');
  });

  it('步骤之间的代码行号范围正确', () => {
    const code = `test('test', async ({ page }) => {
  // @fliwright-step: {"name":"step1"}
  await page.locator({ text: 'a' }).click();

  // @fliwright-step: {"name":"step2"}
  await page.locator({ text: 'b' }).fill('hello');
  await page.locator({ text: 'c' }).tap();
});`;

    const result = parser.parse(code);

    expect(result.steps[0].sourceStartLine).toBe(2); // 第一行代码
    expect(result.steps[0].sourceEndLine).toBe(2);   // 到下一注解前一行
    expect(result.steps[1].sourceStartLine).toBe(5);
    expect(result.steps[1].sourceEndLine).toBe(6);
  });

  it('识别不同的 action 类型', () => {
    const code = `test('test', async ({ page }) => {
  // @fliwright-step: {"name":"mixed"}
  await page.locator({ text: 'btn' }).click();
  await page.locator({ text: 'input' }).fill('val');
  await page.locator({ text: 'list' }).scroll({ dy: 300 });
  await expect(page.locator({ text: 'title' })).toBeVisible();
});`;

    const result = parser.parse(code);
    const atoms = result.steps[0].atoms;

    expect(atoms[0].action).toBe('click');
    expect(atoms[1].action).toBe('fill');
    expect(atoms[2].action).toBe('scroll');
    expect(atoms[3].action).toBe('assert');
  });

  it('提取测试函数名', () => {
    const code = `test('购物流程测试', async ({ page }) => {
  // @fliwright-step: {"name":"step1"}
  await page.locator({ text: 'ok' }).click();
});`;

    const result = parser.parse(code);

    expect(result.testName).toBe('购物流程测试');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/fliwright-vscode && pnpm test -- tests/AnnotationParser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 AnnotationParser**

```typescript
// packages/fliwright-vscode/src/editor/AnnotationParser.ts
import type { StepModel, AtomicStep, StepAnnotation, ParseResult, ParseError } from './types';

const ANNOTATION_PREFIX = '// @fliwright-step:';
const ANNOTATION_REGEX = /^\/\/ @fliwright-step:\s*(.*)$/;
const TEST_NAME_REGEX = /test\s*\(\s*['"`](.+?)['"`]/;

/** 从一行代码中提取 action 类型 */
function detectAction(line: string): AtomicStep['action'] | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('await expect(')) return 'assert';
  if (/\.\bclick\s*\(/.test(trimmed)) return 'click';
  if (/\.\btap\s*\(/.test(trimmed)) return 'tap';
  if (/\.\bfill\s*\(/.test(trimmed)) return 'fill';
  if (/\.\btype\s*\(/.test(trimmed)) return 'type';
  if (/\.\bscroll\s*\(/.test(trimmed)) return 'scroll';
  if (/\.\bdrag\s*\(/.test(trimmed)) return 'drag';
  if (/\.bwaitFor\b/.test(trimmed)) return 'waitFor';
  return null;
}

/** 从 locator 调用行中提取 selector 参数 */
function extractSelector(line: string): string {
  const match = line.match(/locator\s*\(\s*(\{[^}]+\})\s*\)/);
  return match ? match[1] : '';
}

/** 从 action 调用中提取参数值 */
function extractArgument(line: string, action: AtomicStep['action']): string | undefined {
  if (action === 'fill' || action === 'type') {
    const match = line.match(/\.\b(?:fill|type)\s*\(\s*['"`](.+?)['"`]\s*\)/);
    return match ? match[1] : undefined;
  }
  if (action === 'scroll') {
    const match = line.match(/\.\bscroll\s*\(\s*(\{[^}]+\})\s*\)/);
    return match ? match[1] : undefined;
  }
  return undefined;
}

export class AnnotationParser {
  parse(code: string): ParseResult {
    const lines = code.split('\n');
    const steps: StepModel[] = [];
    const errors: ParseError[] = [];
    let testName: string | undefined;

    // 提取测试名
    const testNameMatch = code.match(TEST_NAME_REGEX);
    if (testNameMatch) {
      testName = testNameMatch[1];
    }

    // 找到所有注解行
    const annotationLines: { lineIndex: number; raw: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(ANNOTATION_REGEX);
      if (match) {
        annotationLines.push({ lineIndex: i, raw: match[1] });
      }
    }

    // 解析每个注解和其后的代码
    for (let i = 0; i < annotationLines.length; i++) {
      const { lineIndex, raw } = annotationLines[i];

      // 解析 JSON
      let annotation: StepAnnotation;
      try {
        annotation = JSON.parse(raw) as StepAnnotation;
      } catch {
        errors.push({ line: lineIndex, message: `Invalid JSON in @fliwright-step at line ${lineIndex + 1}` });
        continue;
      }

      // 确定代码范围：从注解下一行到下一个注解前一行（或文件末尾）
      const sourceStartLine = lineIndex + 1;
      const sourceEndLine = i + 1 < annotationLines.length
        ? annotationLines[i + 1].lineIndex
        : lines.length;

      // 提取源代码
      const sourceLines = lines.slice(sourceStartLine, sourceEndLine);
      const sourceCode = sourceLines.join('\n');

      // 解析原子操作
      const atoms: AtomicStep[] = [];
      for (let j = sourceStartLine; j < sourceEndLine; j++) {
        const action = detectAction(lines[j]);
        if (action) {
          atoms.push({
            line: j,
            action,
            selector: extractSelector(lines[j]),
            argument: extractArgument(lines[j], action),
            status: annotation.status ?? 'pending',
          });
        }
      }

      steps.push({
        annotation,
        annotationLine: lineIndex,
        atoms,
        sourceCode,
        sourceStartLine,
        sourceEndLine,
      });
    }

    return { steps, errors, testName };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/fliwright-vscode && pnpm test -- tests/AnnotationParser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vscode/src/editor/AnnotationParser.ts packages/fliwright-vscode/tests/AnnotationParser.test.ts
git commit -m "feat(vscode): add AnnotationParser with tests"
```

---

## Task 3: AnnotationWriter — 测试优先

**Files:**
- Create: `packages/fliwright-vscode/tests/AnnotationWriter.test.ts`
- Create: `packages/fliwright-vscode/src/editor/AnnotationWriter.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/fliwright-vscode/tests/AnnotationWriter.test.ts
import { describe, it, expect } from 'vitest';
import { AnnotationWriter } from '../src/editor/AnnotationWriter';
import type { StepModel, StepAnnotation } from '../src/editor/types';

describe('AnnotationWriter', () => {
  const sampleCode = `test('test', async ({ page }) => {
  // @fliwright-step: {"name":"step1"}
  await page.locator({ text: 'a' }).click();

  // @fliwright-step: {"name":"step2"}
  await page.locator({ text: 'b' }).fill('hello');
  await page.locator({ text: 'c' }).tap();
});`;

  function makeStep(overrides: Partial<StepModel> = {}): StepModel {
    return {
      annotation: { name: 'step1' },
      annotationLine: 1,
      atoms: [],
      sourceCode: "  await page.locator({ text: 'a' }).click();\n",
      sourceStartLine: 2,
      sourceEndLine: 2,
      ...overrides,
    };
  }

  it('修改步骤名称时只改注解 JSON，不动业务代码', () => {
    const writer = new AnnotationWriter();
    const result = writer.updateAnnotation(sampleCode, 1, { name: '重命名步骤' });

    expect(result).toContain('"name":"重命名步骤"');
    expect(result).toContain("await page.locator({ text: 'a' }).click()");
    expect(result).toContain("await page.locator({ text: 'b' }).fill('hello')");
  });

  it('删除步骤时移除注解和对应代码行', () => {
    const writer = new AnnotationWriter();
    const result = writer.deleteStep(sampleCode, { annotationLine: 4, sourceEndLine: 6 });

    expect(result).not.toContain('"name":"step2"');
    expect(result).not.toContain("await page.locator({ text: 'b' }).fill('hello')");
    expect(result).toContain('"name":"step1"');
  });

  it('保持原有缩进和格式', () => {
    const writer = new AnnotationWriter();
    const result = writer.updateAnnotation(sampleCode, 1, { name: 'new name' });

    // 注解行缩进不变
    const lines = result.split('\n');
    expect(lines[1].startsWith('  // @fliwright-step:')).toBe(true);
  });

  it('处理不存在的行号（不修改）', () => {
    const writer = new AnnotationWriter();
    const result = writer.updateAnnotation(sampleCode, 999, { name: 'nope' });

    expect(result).toBe(sampleCode);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/fliwright-vscode && pnpm test -- tests/AnnotationWriter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 AnnotationWriter**

```typescript
// packages/fliwright-vscode/src/editor/AnnotationWriter.ts
import type { StepAnnotation } from './types';

const ANNOTATION_REGEX = /^(\s*)\/\/ @fliwright-step:\s*(.*)$/;

export class AnnotationWriter {
  /** 更新指定行的注解 JSON（合并字段） */
  updateAnnotation(code: string, annotationLine: number, updates: Partial<StepAnnotation>): string {
    const lines = code.split('\n');
    if (annotationLine < 0 || annotationLine >= lines.length) return code;

    const match = lines[annotationLine].match(ANNOTATION_REGEX);
    if (!match) return code;

    const [, indent, rawJson] = match;

    let existing: StepAnnotation;
    try {
      existing = JSON.parse(rawJson) as StepAnnotation;
    } catch {
      return code;
    }

    const merged = { ...existing, ...updates };
    lines[annotationLine] = `${indent}// @fliwright-step: ${JSON.stringify(merged)}`;

    return lines.join('\n');
  }

  /** 删除一个步骤（注解行 + 代码行） */
  deleteStep(code: string, range: { annotationLine: number; sourceEndLine: number }): string {
    const lines = code.split('\n');
    if (range.annotationLine < 0 || range.annotationLine >= lines.length) return code;

    // 删除从注解行到 sourceEndLine
    const deleteCount = range.sourceEndLine - range.annotationLine;
    lines.splice(range.annotationLine, deleteCount);

    return lines.join('\n');
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/fliwright-vscode && pnpm test -- tests/AnnotationWriter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vscode/src/editor/AnnotationWriter.ts packages/fliwright-vscode/tests/AnnotationWriter.test.ts
git commit -m "feat(vscode): add AnnotationWriter with tests"
```

---

## Task 4: EditorBridge — 测试优先

**Files:**
- Create: `packages/fliwright-vscode/tests/EditorBridge.test.ts`
- Create: `packages/fliwright-vscode/src/editor/EditorBridge.ts`

- [ ] **Step 1: 写失败的测试**

```typescript
// packages/fliwright-vscode/tests/EditorBridge.test.ts
import { describe, it, expect, vi } from 'vitest';
import { EditorBridge } from '../src/editor/EditorBridge';
import type { StepModel, ExtToWebview } from '../src/editor/types';

function mockPanel() {
  const messages: ExtToWebview[] = [];
  return {
    postMessage: vi.fn((msg: ExtToWebview) => { messages.push(msg); }),
    messages,
    setLiveMode: vi.fn(),
  };
}

function makeStep(name: string): StepModel {
  return {
    annotation: { name },
    annotationLine: 0,
    atoms: [],
    sourceCode: '',
    sourceStartLine: 1,
    sourceEndLine: 2,
  };
}

describe('EditorBridge', () => {
  it('录制事件转发为 step-added 消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);

    const step = makeStep('新步骤');
    bridge.onStepRecorded(step);

    expect(panel.postMessage).toHaveBeenCalledWith({
      type: 'step-added',
      step,
    });
  });

  it('运行结果转发为 run-status 消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);

    bridge.onStepResult(2, { status: 'fail', error: 'not visible' });

    expect(panel.postMessage).toHaveBeenCalledWith({
      type: 'run-status',
      stepIndex: 2,
      status: 'fail',
      error: 'not visible',
    });
  });

  it('detach 后不再转发消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);
    bridge.detach();

    bridge.onStepRecorded(makeStep('nope'));

    expect(panel.postMessage).not.toHaveBeenCalled();
  });

  it('setLiveMode 发送 live-mode 消息', () => {
    const bridge = new EditorBridge();
    const panel = mockPanel();
    bridge.attach(panel as any);

    bridge.setLiveMode(true);

    expect(panel.postMessage).toHaveBeenCalledWith({
      type: 'live-mode',
      active: true,
    });
  });

  it('无 panel 时静默忽略', () => {
    const bridge = new EditorBridge();
    // 不 attach
    expect(() => bridge.onStepRecorded(makeStep('ok'))).not.toThrow();
    expect(() => bridge.onStepResult(0, { status: 'pass' })).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/fliwright-vscode && pnpm test -- tests/EditorBridge.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 EditorBridge**

```typescript
// packages/fliwright-vscode/src/editor/EditorBridge.ts
import type { StepModel, ExtToWebview } from './types';

export interface StepResult {
  status: 'pass' | 'fail';
  error?: string;
}

export interface EditorPanel {
  postMessage(message: ExtToWebview): void;
}

export class EditorBridge {
  private panel: EditorPanel | undefined;

  attach(panel: EditorPanel): void {
    this.panel = panel;
  }

  detach(): void {
    this.panel = undefined;
  }

  setLiveMode(active: boolean): void {
    this.panel?.postMessage({ type: 'live-mode', active });
  }

  onStepRecorded(step: StepModel): void {
    this.panel?.postMessage({ type: 'step-added', step });
  }

  onStepResult(stepIndex: number, result: StepResult): void {
    this.panel?.postMessage({
      type: 'run-status',
      stepIndex,
      status: result.status,
      error: result.error,
    });
  }

  onRunComplete(summary: { total: number; passed: number; failed: number }): void {
    // 可扩展：发送运行完成汇总
    void summary;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/fliwright-vscode && pnpm test -- tests/EditorBridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fliwright-vscode/src/editor/EditorBridge.ts packages/fliwright-vscode/tests/EditorBridge.test.ts
git commit -m "feat(vscode): add EditorBridge with tests"
```

---

## Task 5: Webview HTML 生成器

**Files:**
- Create: `packages/fliwright-vscode/src/editor/getHtml.ts`

- [ ] **Step 1: 实现 Webview HTML 生成器**

这是纯函数，无需测试框架——直接在编辑器中视觉验证。

```typescript
// packages/fliwright-vscode/src/editor/getHtml.ts
import type { StepModel, ExtToWebview } from './types';

export function getEditorHtml(
  steps: StepModel[],
  options: {
    testName?: string;
    liveMode?: boolean;
    cspSource: string;
    nonce: string;
  },
): string {
  const { testName, liveMode, cspSource, nonce } = options;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${testName ?? 'Fliwright Test Editor'}</title>
  <style nonce="${nonce}">
    :root {
      --step-pass: #4CAF50;
      --step-fail: #f44336;
      --step-warn: #FF9800;
      --step-pending: var(--vscode-descriptionForeground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      overflow: hidden;
    }
    .editor { display: flex; height: 100vh; }

    /* 左侧步骤面板 */
    .step-panel {
      width: 380px;
      min-width: 280px;
      border-right: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .toolbar button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 3px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .toolbar button:hover { background: var(--vscode-button-hoverBackground); }
    .toolbar .stats {
      margin-left: auto;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .live-badge {
      background: #f44336;
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    /* 步骤列表 */
    .step-list { flex: 1; overflow-y: auto; padding: 8px; }
    .step-card {
      margin-bottom: 6px;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border);
      overflow: hidden;
      cursor: pointer;
    }
    .step-card.selected {
      border-color: var(--vscode-focusBorder);
      border-width: 2px;
    }
    .step-card.failed {
      border-color: var(--step-fail);
    }
    .step-header {
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .step-header:hover { background: var(--vscode-list-hoverBackground); }
    .step-card.selected .step-header { background: var(--vscode-editor-selectionBackground); }
    .step-card.failed .step-header { background: rgba(244,67,54,0.08); }
    .step-badge {
      width: 28px; height: 28px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; flex-shrink: 0;
      color: white;
    }
    .step-badge.pass { background: var(--step-pass); }
    .step-badge.fail { background: var(--step-fail); }
    .step-badge.pending { background: var(--step-pending); }
    .step-title { font-weight: 600; }
    .step-meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .step-expand { color: var(--vscode-descriptionForeground); font-size: 10px; }

    /* 子步骤 */
    .sub-steps {
      padding: 4px 12px 8px 50px;
      border-top: 1px dashed var(--vscode-panel-border);
      display: none;
    }
    .step-card.expanded .sub-steps { display: block; }
    .sub-step {
      padding: 4px 0;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }
    .sub-step .dot { width: 8px; height: 8px; border-radius: 50%; }
    .sub-step .dot.pass { background: var(--step-pass); }
    .sub-step .dot.fail { background: var(--step-fail); }
    .sub-step .dot.warn { background: var(--step-warn); }
    .sub-step code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 11px;
    }
    .sub-step .detail { color: var(--vscode-descriptionForeground); }
    .sub-step .warn-tag { color: var(--step-warn); font-size: 10px; }

    /* 右侧面板 */
    .right-panel { flex: 1; display: flex; flex-direction: column; }

    /* 截图区 */
    .screenshot-area {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      position: relative;
    }
    .phone-frame {
      width: 220px;
      height: 400px;
      background: var(--vscode-textBlockQuote-background);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--vscode-panel-border);
      overflow: hidden;
    }
    .phone-frame img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .no-screenshot {
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }

    /* 底部详情 */
    .detail-panel {
      height: 150px;
      border-top: 1px solid var(--vscode-panel-border);
      display: flex;
      flex-direction: column;
    }
    .detail-tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 0 12px;
    }
    .detail-tab {
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent;
    }
    .detail-tab.active {
      font-weight: 600;
      border-bottom-color: var(--vscode-focusBorder);
      color: var(--vscode-foreground);
    }
    .detail-content {
      flex: 1;
      padding: 8px 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      overflow-y: auto;
      display: none;
    }
    .detail-content.active { display: block; }
    .code-line { white-space: pre; }
    .code-comment { color: var(--vscode-descriptionForeground); }
    .code-keyword { color: #569CD6; }
    .code-func { color: #DCDCAA; }
    .code-prop { color: #9CDCFE; }
    .code-string { color: #CE9178; }
    .code-number { color: #B5CEA8; }

    /* 空状态 */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--vscode-descriptionForeground);
      gap: 12px;
    }
    .empty-state .icon { font-size: 48px; }
    .empty-state h3 { font-size: 16px; color: var(--vscode-foreground); }
    .empty-state p { font-size: 13px; max-width: 300px; text-align: center; }
    .empty-state button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="editor" id="editor"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let steps = [];
    let selectedIdx = -1;
    let expandedIdx = -1;
    let activeTab = 'code';

    // 渲染函数
    function render() {
      const editor = document.getElementById('editor');

      if (steps.length === 0) {
        editor.innerHTML = \`
          <div class="empty-state">
            <div class="icon">🧪</div>
            <h3>No visual steps found</h3>
            <p>This test file doesn't contain @fliwright-step annotations yet.</p>
            <div style="display:flex;gap:8px">
              <button onclick="vscode.postMessage({type:'run-test'})">⏺ Record to Generate</button>
            </div>
          </div>\`;
        return;
      }

      editor.innerHTML = \`
        <div class="step-panel">
          <div class="toolbar">
            <button onclick="vscode.postMessage({type:'run-test'})">▶ Run</button>
            <button onclick="vscode.postMessage({type:'open-source'})">📝 Source</button>
            \${liveMode ? '<span class="live-badge">● LIVE</span>' : ''}
            <span class="stats">\${steps.length} steps</span>
          </div>
          <div class="step-list" id="stepList"></div>
        </div>
        <div class="right-panel">
          <div class="screenshot-area" id="screenshotArea"></div>
          <div class="detail-panel">
            <div class="detail-tabs" id="detailTabs"></div>
            <div id="detailContent"></div>
          </div>
        </div>\`;

      renderStepList();
      renderScreenshot();
      renderDetailPanel();
    }

    function renderStepList() {
      const list = document.getElementById('stepList');
      list.innerHTML = steps.map((step, i) => {
        const status = step.annotation.status || 'pending';
        const isSelected = i === selectedIdx;
        const isExpanded = i === expandedIdx;
        const badgeIcon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : String(i + 1);

        return \`
          <div class="step-card \${isSelected ? 'selected' : ''} \${status === 'fail' ? 'failed' : ''} \${isExpanded ? 'expanded' : ''}"
               onclick="selectStep(\${i})" data-idx="\${i}">
            <div class="step-header">
              <div class="step-badge \${status}">\${badgeIcon}</div>
              <div style="flex:1;min-width:0">
                <div class="step-title">\${step.annotation.name}</div>
                <div class="step-meta">\${step.atoms.length} ops\${step.annotation.duration ? ' · ' + (step.annotation.duration/1000).toFixed(1) + 's' : ''}</div>
              </div>
              <span class="step-expand">\${isExpanded ? '▼' : '▶'}</span>
            </div>
            <div class="sub-steps">
              \${step.atoms.map(atom => \`
                <div class="sub-step">
                  <span class="dot \${atom.status === 'fail' ? 'fail' : atom.warning ? 'warn' : 'pass'}"></span>
                  <code>\${atom.action}</code>
                  <span class="detail">\${atom.selector}\${atom.argument ? ': ' + atom.argument : ''}</span>
                  \${atom.warning ? '<span class="warn-tag">⚠ ' + atom.warning + '</span>' : ''}
                </div>
              \`).join('')}
            </div>
          </div>\`;
      }).join('');
    }

    function renderScreenshot() {
      const area = document.getElementById('screenshotArea');
      const step = steps[selectedIdx];
      if (!step || !step.annotation.screenshot) {
        area.innerHTML = '<div class="phone-frame"><div class="no-screenshot"><div style="font-size:32px">📱</div><div>No screenshot</div></div></div>';
        return;
      }
      area.innerHTML = \`<div class="phone-frame"><img src="\${step.annotation.screenshot}" alt="Step screenshot"></div>\`;
    }

    function renderDetailPanel() {
      const tabs = document.getElementById('detailTabs');
      const content = document.getElementById('detailContent');
      const tabNames = ['code', 'network', 'assertions', 'healing'];
      const tabLabels = { code: 'Code', network: 'Network', assertions: 'Assertions', healing: 'Healing' };

      tabs.innerHTML = tabNames.map(t =>
        \`<div class="detail-tab \${t === activeTab ? 'active' : ''}" onclick="switchTab('\${t}')">\${tabLabels[t]}</div>\`
      ).join('');

      const step = steps[selectedIdx];
      content.innerHTML = renderTabContent(activeTab, step);
      // Activate first content div
      const contents = content.querySelectorAll('.detail-content');
      contents.forEach(c => c.classList.toggle('active', c.dataset.tab === activeTab));
    }

    function renderTabContent(tab, step) {
      if (!step) return '';
      if (tab === 'code') {
        const lines = step.sourceCode.split('\\n').map(line => {
          let colored = escapeHtml(line);
          colored = colored.replace(/\\bawait\\b/g, '<span class="code-keyword">await</span>');
          colored = colored.replace(/\\bexpect\\b/g, '<span class="code-func">expect</span>');
          colored = colored.replace(/\\bpage\\b/g, '<span class="code-prop">page</span>');
          colored = colored.replace(/\\blocator\\b/g, '<span class="code-func">locator</span>');
          colored = colored.replace(/'([^']+)'/g, "<span class=\"code-string\">'$1'</span>");
          return '<div class="code-line">' + colored + '</div>';
        }).join('');
        return \`<div class="detail-content active" data-tab="code"><div class="code-line code-comment">// @fliwright-step: \${JSON.stringify(step.annotation)}</div>\${lines}</div>\`;
      }
      if (tab === 'assertions') {
        const atoms = step.atoms.filter(a => a.action === 'assert');
        if (atoms.length === 0) return '<div class="detail-content active" data-tab="assertions" style="color:var(--vscode-descriptionForeground)">No assertions in this step.</div>';
        return '<div class="detail-content active" data-tab="assertions">' + atoms.map(a =>
          \`<div class="code-line"><span class="dot \${a.status}" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;\${a.status === 'pass' ? 'background:var(--step-pass)' : 'background:var(--step-fail)'}"></span>\${escapeHtml(a.selector)} \${a.status}</div>\`
        ).join('') + '</div>';
      }
      return \`<div class="detail-content active" data-tab="\${tab}" style="color:var(--vscode-descriptionForeground)">No data for this tab yet.</div>\`;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 交互
    function selectStep(idx) {
      if (selectedIdx === idx) {
        // Toggle expand
        expandedIdx = expandedIdx === idx ? -1 : idx;
        vscode.postMessage({ type: 'toggle-expand', index: idx });
      } else {
        selectedIdx = idx;
        expandedIdx = idx;
        vscode.postMessage({ type: 'select-step', index: idx });
      }
      render();
    }

    function switchTab(tab) {
      activeTab = tab;
      render();
    }

    // 消息监听
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'init') {
        steps = msg.steps;
        selectedIdx = steps.length > 0 ? 0 : -1;
        render();
      } else if (msg.type === 'step-updated') {
        steps[msg.index] = msg.step;
        render();
      } else if (msg.type === 'step-added') {
        steps.push(msg.step);
        selectedIdx = steps.length - 1;
        render();
      } else if (msg.type === 'run-status') {
        if (steps[msg.stepIndex]) {
          steps[msg.stepIndex].annotation.status = msg.status;
          if (msg.error) steps[msg.stepIndex].annotation.error = msg.error;
          render();
        }
      } else if (msg.type === 'live-mode') {
        liveMode = msg.active;
        render();
      } else if (msg.type === 'navigate-to-failure') {
        selectedIdx = msg.stepIndex;
        expandedIdx = msg.stepIndex;
        render();
      }
    });
  </script>
</body>
</html>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/fliwright-vscode/src/editor/getHtml.ts
git commit -m "feat(vscode): add webview HTML generator for test editor"
```

---

## Task 6: TestEditorPanel — Webview 生命周期

**Files:**
- Create: `packages/fliwright-vscode/src/editor/TestEditorPanel.ts`

- [ ] **Step 1: 实现 TestEditorPanel**

```typescript
// packages/fliwright-vscode/src/editor/TestEditorPanel.ts
import * as vscode from 'vscode';
import { AnnotationParser } from './AnnotationParser';
import { AnnotationWriter } from './AnnotationWriter';
import { getEditorHtml } from './getHtml';
import type { StepModel, WebviewToExt, ExtToWebview } from './types';

export class TestEditorPanel {
  private readonly panel: vscode.WebviewPanel;
  private readonly parser = new AnnotationParser();
  private readonly writer = new AnnotationWriter();
  private steps: StepModel[] = [];
  private testName?: string;
  private disposables: vscode.Disposable[] = [];

  constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly document: vscode.TextDocument,
  ) {
    this.panel = panel;

    // 设置 Webview 选项
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, '.fliwright', 'snapshots'),
      ],
    };

    // 处理 Webview 消息
    panel.webview.onDidReceiveMessage((msg: WebviewToExt) => {
      this.handleMessage(msg);
    }, null, this.disposables);

    // 首次渲染
    this.refreshFromDocument();
  }

  /** 从文档内容解析并渲染 */
  refreshFromDocument(): void {
    const code = this.document.getText();
    const result = this.parser.parse(code);
    this.steps = result.steps;
    this.testName = result.testName;
    this.render();
  }

  /** 发送消息到 Webview */
  postMessage(message: ExtToWebview): void {
    this.panel.webview.postMessage(message);
  }

  private render(): void {
    const code = this.document.getText();
    this.panel.webview.html = getEditorHtml(this.steps, {
      testName: this.testName,
      cspSource: this.panel.webview.cspSource,
      nonce: getNonce(),
    });
    // 初始化步骤数据
    this.panel.webview.postMessage({
      type: 'init',
      steps: this.steps,
      code,
      testName: this.testName,
    } satisfies ExtToWebview);
  }

  private async handleMessage(msg: WebviewToExt): Promise<void> {
    switch (msg.type) {
      case 'select-step':
      case 'toggle-expand':
        // 纯 UI 状态，Webview 自行处理
        break;

      case 'edit-step-name': {
        const step = this.steps[msg.index];
        if (!step) break;
        const code = this.document.getText();
        const updated = this.writer.updateAnnotation(code, step.annotationLine, { name: msg.name });
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          this.document.lineAt(0).range.start,
          this.document.lineAt(this.document.lineCount - 1).range.end,
        );
        edit.replace(this.document.uri, fullRange, updated);
        await vscode.workspace.applyEdit(edit);
        break;
      }

      case 'delete-step': {
        const step = this.steps[msg.index];
        if (!step) break;
        const code = this.document.getText();
        const updated = this.writer.deleteStep(code, {
          annotationLine: step.annotationLine,
          sourceEndLine: step.sourceEndLine,
        });
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(
          this.document.lineAt(0).range.start,
          this.document.lineAt(this.document.lineCount - 1).range.end,
        );
        edit.replace(this.document.uri, fullRange, updated);
        await vscode.workspace.applyEdit(edit);
        break;
      }

      case 'open-source': {
        const step = this.steps.length > 0 ? this.steps[0] : undefined;
        const line = step ? step.annotationLine : 0;
        await vscode.window.showTextDocument(this.document.uri, {
          selection: new vscode.Range(line, 0, line, 0),
        });
        break;
      }

      case 'run-test':
        await vscode.commands.executeCommand('fliwright.runCurrentTest');
        break;

      case 'edit-code':
      case 'apply-healing':
        // 后续 Task 中实现
        break;
    }
  }

  dispose(): void {
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/fliwright-vscode/src/editor/TestEditorPanel.ts
git commit -m "feat(vscode): add TestEditorPanel with webview lifecycle"
```

---

## Task 7: TestEditorProvider — CustomEditorProvider 注册

**Files:**
- Create: `packages/fliwright-vscode/src/editor/TestEditorProvider.ts`
- Modify: `packages/fliwright-vscode/package.json` — 新增 customEditors 贡献点

- [ ] **Step 1: 实现 TestEditorProvider**

```typescript
// packages/fliwright-vscode/src/editor/TestEditorProvider.ts
import * as vscode from 'vscode';
import { TestEditorPanel } from './TestEditorPanel';

export class TestEditorProvider implements vscode.CustomEditorProvider<TestDocument> {
  private readonly panels = new Map<string, TestEditorPanel>();

  constructor(private readonly extensionUri: vscode.Uri) {}

  async openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<TestDocument> {
    const content = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(content);

    // 检查是否包含 @fliwright-step 注解
    if (!text.includes('@fliwright-step')) {
      // 返回普通文档，编辑器会显示引导界面
    }

    return { uri, content: text };
  }

  async resolveCustomEditor(
    document: TestDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(document.uri);
    const panel = new TestEditorPanel(webviewPanel, this.extensionUri, doc);
    this.panels.set(document.uri.toString(), panel);

    webviewPanel.onDidDispose(() => {
      this.panels.delete(document.uri.toString());
    });
  }

  /** 获取指定 URI 的编辑器面板（供 EditorBridge 使用） */
  getPanel(uri: vscode.Uri): TestEditorPanel | undefined {
    return this.panels.get(uri.toString());
  }

  saveCustomDocument(_document: TestDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
    return Promise.resolve();
  }

  saveCustomDocumentAs(_document: TestDocument, _destination: vscode.Uri, _cancellation: vscode.CancellationToken): Thenable<void> {
    return Promise.resolve();
  }

  revertCustomDocument(_document: TestDocument, _cancellation: vscode.CancellationToken): Thenable<void> {
    return Promise.resolve();
  }

  backupCustomDocument(_document: TestDocument, _context: vscode.CustomDocumentBackupContext, _cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
    return Promise.resolve({ id: '', delete: () => {} });
  }
}

export interface TestDocument extends vscode.CustomDocument {
  content: string;
}
```

- [ ] **Step 2: 在 package.json 中添加 customEditors 贡献点**

在 `packages/fliwright-vscode/package.json` 的 `contributes` 对象中添加：

```json
"customEditors": [
  {
    "viewType": "fliwright.testEditor",
    "displayName": "Fliwright Test Editor",
    "selector": [
      { "filenamePattern": "**/*.test.ts" },
      { "filenamePattern": "**/*.spec.ts" }
    ],
    "priority": "option"
  }
]
```

注意 `priority: "option"` 表示用户需要右键 "Open With" 选择此编辑器，不会覆盖默认代码编辑器。

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-vscode/src/editor/TestEditorProvider.ts packages/fliwright-vscode/package.json
git commit -m "feat(vscode): add TestEditorProvider with customEditors contribution"
```

---

## Task 8: 集成到 extension.ts

**Files:**
- Modify: `packages/fliwright-vscode/src/extension.ts`

- [ ] **Step 1: 在 activate 函数中注册 TestEditorProvider**

在 `packages/fliwright-vscode/src/extension.ts` 的 `activate` 函数中，在服务注册之后添加：

```typescript
import { TestEditorProvider } from './editor/TestEditorProvider';
import { EditorBridge } from './editor/EditorBridge';

export function activate(context: vscode.ExtensionContext) {
  // ... 现有服务注册 ...

  // 注册可视化测试编辑器
  const editorProvider = new TestEditorProvider(context.extensionUri);
  const editorBridge = new EditorBridge();

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'fliwright.testEditor',
      editorProvider,
      { supportsMultipleEditorsPerDocument: false },
    ),
  );

  // 注册 "Open in Visual Editor" 命令
  context.subscriptions.push(
    vscode.commands.registerCommand('fliwright.openVisualEditor', async (uri?: vscode.Uri) => {
      if (!uri) {
        const active = vscode.window.activeTextEditor;
        if (active) {
          uri = active.document.uri;
        }
      }
      if (uri) {
        await vscode.commands.executeCommand('vscode.openWith', uri, 'fliwright.testEditor');
      }
    }),
  );

  // ... 其余现有代码 ...
}
```

- [ ] **Step 2: 在 package.json 的 commands 中注册新命令**

在 `contributes.commands` 数组中添加：

```json
{
  "command": "fliwright.openVisualEditor",
  "title": "Fliwright: Open Visual Test Editor",
  "icon": "$(eye)"
}
```

并在 `menus` 的 `editor/title` 中添加入口：

```json
{
  "command": "fliwright.openVisualEditor",
  "when": "resourceExtname == .ts && resourceFilename =~ /\\.test\\.ts$|\\.spec\\.ts$/",
  "group": "navigation"
}
```

- [ ] **Step 3: 构建验证**

Run: `cd packages/fliwright-vscode && pnpm run build`
Expected: 编译成功，无错误

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-vscode/src/extension.ts packages/fliwright-vscode/package.json
git commit -m "feat(vscode): integrate visual test editor into extension activation"
```

---

## Task 9: RecorderService 集成 EditorBridge

**Files:**
- Modify: `packages/fliwright-vscode/src/recording/RecorderService.ts`

- [ ] **Step 1: 在 RecorderService 中添加步骤级回调**

在 `RecorderService` 类中，为 `start` 方法的 `RecordingStartOptions` 新增 `onStepRecorded` 回调：

```typescript
// 在 RecorderService.ts 中添加（在现有 onDidChange 回调附近）

export interface RecordingStartOptions {
  testName?: string;
  onDidChange?: (session: RecordingSession) => void;
  /** 新增：每录制一个操作时的回调 */
  onStepRecorded?: (step: { action: string; selector: string; timestamp: number }) => void;
}
```

- [ ] **Step 2: 在 extension.ts 中桥接录制事件到编辑器**

在录制开始时，将 `onStepRecorded` 连接到 `EditorBridge`：

```typescript
// 在 extension.ts 的 startRecording 命令处理中

context.subscriptions.push(
  vscode.commands.registerCommand('fliwright.startRecording', async () => {
    // ... 现有连接检查 ...

    // 启动录制，带步骤回调
    await recorderService.start(driver, {
      testName: 'recorded test',
      onDidChange: (session) => { /* 现有 UI 更新 */ },
      onStepRecorded: (step) => {
        // 转发给编辑器
        const activePanels = editorProvider.getActivePanels();
        for (const panel of activePanels) {
          panel.postMessage({
            type: 'step-added',
            step: {
              annotation: { name: step.action },
              annotationLine: -1,
              atoms: [{
                line: -1,
                action: step.action as any,
                selector: step.selector,
                status: 'pending',
              }],
              sourceCode: '',
              sourceStartLine: -1,
              sourceEndLine: -1,
            },
          });
        }
      },
    });
  }),
);
```

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-vscode/src/recording/RecorderService.ts packages/fliwright-vscode/src/extension.ts
git commit -m "feat(vscode): bridge recording events to visual editor"
```

---

## Task 10: 侧栏 Tests 视图增强

**Files:**
- Modify: `packages/fliwright-vscode/src/views/TestsTreeProvider.ts`
- Modify: `packages/fliwright-vscode/package.json`

- [ ] **Step 1: 更新 TestsTreeProvider 支持测试内步骤节点**

在 `TestsTreeProvider` 的 `getChildren` 方法中，当展开一个测试文件节点时，解析其 `@fliwright-step` 注解并显示为子节点：

```typescript
// 在 TestsTreeProvider.ts 中

import { AnnotationParser } from '../editor/AnnotationParser';

// 在 getChildren 中添加：
async getChildren(element?: TestTreeNode): Promise<TestTreeNode[]> {
  if (!element) {
    // 返回测试文件列表（现有逻辑）
    return this.getTestFiles();
  }

  if (element.kind === 'file') {
    // 解析文件中的 @fliwright-step 注解
    const content = await vscode.workspace.fs.readFile(element.uri);
    const code = new TextDecoder().decode(content);
    const parser = new AnnotationParser();
    const result = parser.parse(code);

    return result.steps.map((step, i) => ({
      kind: 'step' as const,
      label: step.annotation.name,
      status: step.annotation.status ?? 'pending',
      stepIndex: i,
      fileUri: element.uri,
    }));
  }

  return [];
}
```

- [ ] **Step 2: 在 getTreeItem 中为步骤节点设置点击行为**

```typescript
getTreeItem(element: TestTreeNode): vscode.TreeItem {
  if (element.kind === 'step') {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(
      element.status === 'pass' ? 'check' :
      element.status === 'fail' ? 'error' :
      'circle-outline'
    );
    item.command = {
      command: 'fliwright.openVisualEditor',
      arguments: [element.fileUri],
      title: 'Open in Visual Editor',
    };
    return item;
  }
  // ... 现有文件节点逻辑 ...
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/fliwright-vscode/src/views/TestsTreeProvider.ts
git commit -m "feat(vscode): enhance Tests tree view with step-level nodes"
```

---

## Task 11: 命令重定向 — 替换 RecordingPanel 和 FailurePanel 入口

**Files:**
- Modify: `packages/fliwright-vscode/src/extension.ts`

- [ ] **Step 1: 重定向 startRecording 命令**

将 `fliwright.startRecording` 命令改为录制后自动打开可视化编辑器：

```typescript
// 替换现有的 startRecording 命令注册
context.subscriptions.push(
  vscode.commands.registerCommand('fliwright.startRecording', async () => {
    // ... 现有连接和驱动初始化逻辑保持不变 ...

    await recorderService.start(driver, {
      onDidChange: (session) => {
        if (session.status === 'preview' && session.targetFile) {
          // 录制完成后，打开可视化编辑器（替代 RecordingPanel）
          const uri = vscode.Uri.file(session.targetFile);
          vscode.commands.executeCommand('vscode.openWith', uri, 'fliwright.testEditor');
          editorBridge.setLiveMode(false);
        }
      },
    });

    // 进入 LIVE 模式
    editorBridge.setLiveMode(true);
  }),
);
```

- [ ] **Step 2: 重定向 showFailure 命令**

将 `fliwright.showFailure` 命令改为打开编辑器并定位到失败步骤：

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('fliwright.showFailure', async (context: any) => {
    if (context?.testFileUri) {
      await vscode.commands.executeCommand('vscode.openWith', context.testFileUri, 'fliwright.testEditor');
      if (context.failedStepIndex !== undefined) {
        const panel = editorProvider.getPanel(context.testFileUri);
        panel?.postMessage({
          type: 'navigate-to-failure',
          stepIndex: context.failedStepIndex,
        });
      }
    }
  }),
);
```

- [ ] **Step 3: 构建验证**

Run: `cd packages/fliwright-vscode && pnpm run build`
Expected: 编译成功

- [ ] **Step 4: Commit**

```bash
git add packages/fliwright-vscode/src/extension.ts
git commit -m "feat(vscode): redirect recording/failure commands to visual editor"
```

---

## Task 12: 手动集成验证

- [ ] **Step 1: 构建扩展**

Run: `cd packages/fliwright-vscode && pnpm run build`

- [ ] **Step 2: 在 VS Code 中加载扩展**

按 F5 启动 Extension Development Host，或使用 `code --extensionDevelopmentPath` 参数。

- [ ] **Step 3: 准备测试文件**

创建一个带 `@fliwright-step` 注解的测试文件：

```typescript
import { test, expect } from '@fliwright/vitest';

test('demo', async ({ page }) => {
  // @fliwright-step: {"name":"点击按钮","status":"pass"}
  await page.locator({ text: '登录' }).click();

  // @fliwright-step: {"name":"输入文字","status":"pass"}
  await page.locator({ text: '输入框' }).fill('hello');
  await page.locator({ text: '提交' }).click();
});
```

- [ ] **Step 4: 验证编辑器打开**

- 右键测试文件 → "Open With → Fliwright Test Editor"
- 确认左侧显示 2 个步骤卡片
- 点击步骤，右侧切换
- 展开步骤，查看子步骤
- 底部 Tab 切换（Code / Assertions）

- [ ] **Step 5: 验证侧栏**

- 侧栏 Tests 视图中展开测试文件
- 确认显示步骤子节点
- 点击步骤子节点打开编辑器

- [ ] **Step 6: Commit 最终状态**

```bash
git add -A
git commit -m "feat(vscode): complete visual test editor v1"
```
