# 录制交互可视化增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让录制画布对 tap/longPress/drag/type 四种交互清晰可见——按类型渲染标记（滑动箭头/长按时长/输入文本）、为无前置 tap 的文本输入补合成帧、新增右侧操作列表面板。

**Architecture:** 后端在 `RecorderController.syncFramesWithOperations` 给"无帧 operation"补合成帧（用显式 `synthetic` 字段标记）；前端把纯渲染逻辑抽到 `marker-utils.ts`（可单测），`app.tsx` 的节点按 kind 渲染、新增右侧栏、minimap 按 kind 上色。不动 Dart / wire protocol / EventAggregator / CodeGenerator。

**Tech Stack:** TypeScript、React + @xyflow/react（ReactFlow）、vitest、esbuild（webview 打包）。

**Spec:** `docs/superpowers/specs/2026-06-13-recording-interaction-visualization-design.md`
**分支:** `recording-interaction-visualization`

**测试命令速查:**
- Core 单测：`pnpm --filter @fliwright/core test`（或单文件：`pnpm --filter @fliwright/core test tests/RecorderController.test.ts`）
- VS Code 单测：`pnpm --filter @fliwright/vscode test`
- 类型检查：`pnpm --filter @fliwright/vscode lint`、`pnpm --filter @fliwright/core lint`
- Webview 打包验证：`pnpm --filter @fliwright/vscode bundle:webview`

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `packages/fliwright-core/src/types.ts` | `RecordingFrame` 类型 | 增加 `synthetic?: boolean` |
| `packages/fliwright-core/src/RecorderController.ts` | 录制状态机 | `syncFramesWithOperations` 增加无帧 op 的合成帧兜底 |
| `packages/fliwright-core/tests/RecorderController.test.ts` | 后端测试 | 新增独立 type 补帧、drag 帧用例 |
| `packages/fliwright-vscode/src/webview/recording-canvas/marker-utils.ts` | 纯渲染逻辑（颜色/方向/时长/坐标/标签） | 新建 |
| `packages/fliwright-vscode/tests/marker-utils.test.ts` | 上述纯函数单测 | 新建 |
| `packages/fliwright-vscode/src/webview/recording-canvas/app.tsx` | 画布 UI | 节点 kind-aware 渲染、右侧栏、minimap 上色 |
| `packages/fliwright-vscode/src/webview/recording-canvas/styles.css` | 画布样式 | kind-aware 标记、箭头、徽标、侧栏样式 |

---

## Task 1: 后端——为无帧 operation 补合成帧

**Files:**
- Modify: `packages/fliwright-core/src/types.ts:347-349`（`RecordingFrame` 末尾）
- Modify: `packages/fliwright-core/src/RecorderController.ts:327-350`（`syncFramesWithOperations`）
- Test: `packages/fliwright-core/tests/RecorderController.test.ts`（追加用例）

- [ ] **Step 1: 写失败测试（独立文本输入补帧）**

在 `packages/fliwright-core/tests/RecorderController.test.ts` 末尾、最后一个 `});`（describe 结束）之前追加：

```ts
  it('synthesizes a visible frame for a standalone textInput with no preceding tap', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({ success: true, screenshot: 'b64', width: 320, height: 640, pixelRatio: 1 });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ captureScreenshots: true });
    eventCallback?.({
      kind: 'FliwrightRecording',
      timestamp: Date.now(),
      data: { type: 'textInput', text: 'hello', timestamp: 5000 },
    });
    await controller.stop();

    const frames = controller.getFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(expect.objectContaining({
      kind: 'type',
      text: 'hello',
      synthetic: true,
    }));
  });

  it('records a drag operation as a frame carrying its delta', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'ext.fliwright.screenshot') {
        return Promise.resolve({ success: true, screenshot: 'b64', width: 320, height: 640, pixelRatio: 1 });
      }
      if (method === 'ext.fliwright.hitTest') {
        return Promise.resolve({ widget: { id: '1', type: 'ListView', properties: {} } });
      }
      return Promise.resolve({});
    });
    let eventCallback: ((event: { kind: string; timestamp: number; data: Record<string, unknown> }) => void) | null = null;
    const controller = new RecorderController(
      sendRequest,
      vi.fn().mockImplementation((callback) => {
        eventCallback = callback;
        return () => {};
      }),
    );

    await controller.start({ captureScreenshots: true });
    for (const [ts, kind, x, y] of [
      [1000, 'down', 160, 100],
      [1050, 'move', 160, 200],
      [1100, 'move', 160, 300],
      [1200, 'up', 160, 300],
    ] as const) {
      eventCallback?.({
        kind: 'FliwrightRecording',
        timestamp: Date.now(),
        data: { type: 'pointerEvent', kind, pointer: 0, position: { x, y }, timestamp: ts, buttons: kind === 'up' ? 0 : 1 },
      });
    }
    await controller.stop();

    const frames = controller.getFrames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(expect.objectContaining({
      kind: 'drag',
      delta: { x: 0, y: 200 },
    }));
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fliwright/core test tests/RecorderController.test.ts`
Expected: 两个新用例 FAIL（`synthetic` 字段当前不存在，独立 textInput 不产生帧；drag 帧 delta 断言可能因已有逻辑通过，但第一个用例必失败）。

- [ ] **Step 3: 给 `RecordingFrame` 加 `synthetic` 字段**

Modify `packages/fliwright-core/src/types.ts`，在 `RecordingFrame` 接口的 `screenshotError?: string;` 之后加一行：

```ts
  screenshot?: RecordingScreenshot;
  screenshotError?: string;
  synthetic?: boolean;
}
```

- [ ] **Step 4: 在 `syncFramesWithOperations` 增加合成帧兜底**

Modify `packages/fliwright-core/src/RecorderController.ts` 的 `syncFramesWithOperations`（约 327 行）。把当前的：

```ts
  private syncFramesWithOperations(): void {
    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i];
      const frameIndex = this.findFrameIndexForOperation(op, i);
      if (frameIndex < 0) continue;
      const frame = this.frames[frameIndex];
```

替换为（在 `frameIndex < 0` 时合成一个帧，而不是 `continue`）：

```ts
  private syncFramesWithOperations(): void {
    for (let i = 0; i < this.operations.length; i++) {
      const op = this.operations[i];
      let frameIndex = this.findFrameIndexForOperation(op, i);
      if (frameIndex < 0) {
        // Operation has no captured frame (e.g. standalone text input with no
        // preceding pointer-down). Synthesize one so every operation stays
        // visible in the canvas. Gated on captureScreenshots like real frames.
        if (!this.activeOptions?.captureScreenshots) continue;
        const synthetic: RecordingFrame = {
          id: `frame-synthetic-${op.timestamp}-${i}`,
          index: this.frames.length,
          kind: op.kind,
          status: this.latestScreenshot ? 'ready' : 'capturing',
          timestamp: op.timestamp,
          operationIndex: i,
          position: { x: op.position.x, y: op.position.y },
          delta: op.delta ? { x: op.delta.x, y: op.delta.y } : undefined,
          text: op.text,
          action: op.action,
          duration: op.duration,
          operationStatus: op.status,
          ignoreReason: op.ignoreReason,
          confidence: op.confidence,
          screenshot: this.latestScreenshot ? { ...this.latestScreenshot } : undefined,
          synthetic: true,
        };
        this.frames.push(synthetic);
        this.emitFrame(synthetic);
        continue;
      }
      const frame = this.frames[frameIndex];
```

注意：保留方法剩余部分（`const updated: RecordingFrame = { ... }` 及之后的 `if (!sameFrame(...))` 分支）不变。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @fliwright/core test tests/RecorderController.test.ts`
Expected: PASS（全部用例，含两个新用例）。

- [ ] **Step 6: 跑 core 全量 + 类型检查**

Run: `pnpm --filter @fliwright/core test && pnpm --filter @fliwright/core lint`
Expected: 全部 PASS，无类型错误。

- [ ] **Step 7: 提交**

```bash
git add packages/fliwright-core/src/types.ts packages/fliwright-core/src/RecorderController.ts packages/fliwright-core/tests/RecorderController.test.ts
git commit -m "feat(recorder): synthesize frames for operations without a captured pointer-down"
```

---

## Task 2: 抽取 marker-utils 纯函数 + 单测

**Files:**
- Create: `packages/fliwright-vscode/src/webview/recording-canvas/marker-utils.ts`
- Test: `packages/fliwright-vscode/tests/marker-utils.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/fliwright-vscode/tests/marker-utils.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { RecordingFrame } from '@fliwright/core';
import {
  kindColor,
  formatDuration,
  swipeDirection,
  swipeDistance,
  markerPercent,
  markerEndPercent,
  coordLabel,
  badgeLabel,
} from '../src/webview/recording-canvas/marker-utils.js';

function frame(over: Partial<RecordingFrame> = {}): RecordingFrame {
  return {
    id: 'f', index: 0, kind: 'tap', status: 'ready', timestamp: 0,
    position: { x: 0, y: 0 }, ...over,
  } as RecordingFrame;
}

describe('marker-utils', () => {
  it('maps each kind to its color', () => {
    expect(kindColor('tap')).toBe('#4b8f78');
    expect(kindColor('longPress')).toBe('#e0a458');
    expect(kindColor('drag')).toBe('#58a6ff');
    expect(kindColor('type')).toBe('#a371f7');
    expect(kindColor('pending')).toBe('#8a8f98');
  });

  it('formats duration from microseconds', () => {
    expect(formatDuration(1_200_000)).toBe('1.2s');
    expect(formatDuration(500_000)).toBe('500ms');
    expect(formatDuration(undefined)).toBe('');
  });

  it('derives swipe direction from delta', () => {
    expect(swipeDirection({ x: 0, y: 180 })).toBe('↓');
    expect(swipeDirection({ x: 0, y: -90 })).toBe('↑');
    expect(swipeDirection({ x: 120, y: 0 })).toBe('→');
    expect(swipeDirection({ x: -5, y: 0 })).toBe('←');
    expect(swipeDirection(undefined)).toBe('');
  });

  it('computes rounded swipe distance', () => {
    expect(swipeDistance({ x: 100, y: 100 })).toBe(141);
    expect(swipeDistance(undefined)).toBe(0);
  });

  it('centers synthetic frames regardless of position', () => {
    const f = frame({ synthetic: true, position: { x: 10, y: 10 }, screenshot: { base64: '', format: 'png', width: 320, height: 640 } });
    expect(markerPercent(f)).toEqual({ x: 50, y: 50 });
  });

  it('places non-synthetic frames by coordinate', () => {
    const f = frame({ position: { x: 160, y: 320 }, screenshot: { base64: '', format: 'png', width: 320, height: 640 } });
    expect(markerPercent(f)).toEqual({ x: 50, y: 50 });
  });

  it('computes drag arrow end from delta as percentages', () => {
    const f = frame({
      kind: 'drag',
      position: { x: 0, y: 0 },
      delta: { x: 320, y: 0 },
      screenshot: { base64: '', format: 'png', width: 320, height: 640 },
    });
    expect(markerEndPercent(f)).toEqual({ x: 100, y: 0 });
  });

  it('returns null end for non-drag frames', () => {
    expect(markerEndPercent(frame({ kind: 'tap' }))).toBeNull();
  });

  it('hides coord label for synthetic frames', () => {
    expect(coordLabel(frame({ synthetic: true, position: { x: 5, y: 6 } }))).toBe('');
    expect(coordLabel(frame({ position: { x: 5.7, y: 6.2 } }))).toBe('6, 6');
  });

  it('builds kind badges', () => {
    expect(badgeLabel(frame({ kind: 'longPress', duration: 800_000 }))).toBe('⏱ 800ms');
    expect(badgeLabel(frame({ kind: 'drag', delta: { x: 0, y: 180 } }))).toBe('↓ 180px');
    expect(badgeLabel(frame({ kind: 'type', text: 'leo@mail.com' }))).toBe('⌨ "leo@mail.com"');
    expect(badgeLabel(frame({ kind: 'type', text: 'x', action: 'replace' }))).toBe('⌨ "x" ↻');
    expect(badgeLabel(frame({ kind: 'tap' }))).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @fliwright/vscode test tests/marker-utils.test.ts`
Expected: FAIL（模块不存在，导入报错）。

- [ ] **Step 3: 实现 marker-utils**

Create `packages/fliwright-vscode/src/webview/recording-canvas/marker-utils.ts`：

```ts
import type { RecordingFrame } from '@fliwright/core';

export type FrameKind = RecordingFrame['kind'];

export const KIND_COLORS: Record<FrameKind, string> = {
  tap: '#4b8f78',
  longPress: '#e0a458',
  drag: '#58a6ff',
  type: '#a371f7',
  pending: '#8a8f98',
};

export function kindColor(kind: FrameKind): string {
  return KIND_COLORS[kind] ?? KIND_COLORS.pending;
}

/** Formats a microsecond duration (Dart's inMicroseconds) as `800ms` / `1.2s`. */
export function formatDuration(durationMicros?: number): string {
  if (!durationMicros || durationMicros <= 0) return '';
  const ms = durationMicros / 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/** Arrow glyph for the dominant axis of a drag delta. */
export function swipeDirection(delta?: { x: number; y: number }): string {
  if (!delta) return '';
  const absX = Math.abs(delta.x);
  const absY = Math.abs(delta.y);
  if (absX < 1 && absY < 1) return '';
  if (absY >= absX) return delta.y > 0 ? '↓' : '↑';
  return delta.x > 0 ? '→' : '←';
}

export function swipeDistance(delta?: { x: number; y: number }): number {
  if (!delta) return 0;
  return Math.round(Math.sqrt(delta.x ** 2 + delta.y ** 2));
}

/** Marker center as percentages within the screenshot. Synthetic frames center. */
export function markerPercent(frame: RecordingFrame): { x: number; y: number } {
  const width = frame.screenshot?.width;
  const height = frame.screenshot?.height;
  if (!width || !height || frame.synthetic) return { x: 50, y: 50 };
  return {
    x: clamp((frame.position.x / width) * 100, 0, 100),
    y: clamp((frame.position.y / height) * 100, 0, 100),
  };
}

/** Drag arrow end as percentages; null for non-drag or unsized frames. */
export function markerEndPercent(frame: RecordingFrame): { x: number; y: number } | null {
  if (frame.kind !== 'drag' || !frame.delta) return null;
  const width = frame.screenshot?.width;
  const height = frame.screenshot?.height;
  if (!width || !height) return null;
  const start = markerPercent(frame);
  return {
    x: clamp(start.x + (frame.delta.x / width) * 100, 0, 100),
    y: clamp(start.y + (frame.delta.y / height) * 100, 0, 100),
  };
}

export function coordLabel(frame: RecordingFrame): string {
  if (frame.synthetic) return '';
  return `${Math.round(frame.position.x)}, ${Math.round(frame.position.y)}`;
}

/** Inline badge text for longPress / drag / type; empty for tap/pending. */
export function badgeLabel(frame: RecordingFrame): string {
  switch (frame.kind) {
    case 'longPress': {
      const d = formatDuration(frame.duration);
      return d ? `⏱ ${d}` : '';
    }
    case 'drag': {
      const dist = swipeDistance(frame.delta);
      if (dist <= 0) return '';
      return `${swipeDirection(frame.delta)} ${dist}px`.trim();
    }
    case 'type': {
      if (!frame.text) return '';
      const replace = frame.action === 'replace' ? ' ↻' : '';
      return `⌨ "${frame.text}"${replace}`;
    }
    default:
      return '';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @fliwright/vscode test tests/marker-utils.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter @fliwright/vscode lint`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add packages/fliwright-vscode/src/webview/recording-canvas/marker-utils.ts packages/fliwright-vscode/tests/marker-utils.test.ts
git commit -m "feat(webview): extract kind-aware marker utils with unit tests"
```

---

## Task 3: 样式——kind-aware 标记 / 箭头 / 徽标 / 侧栏

**Files:**
- Modify: `packages/fliwright-vscode/src/webview/recording-canvas/styles.css`

- [ ] **Step 1: 改 `.tap-marker` 用 CSS 变量上色**

在 `styles.css` 中，把 `.tap-marker`（约 245 行）整段替换为（颜色改为 `var(--marker-color)`，默认值兜底）：

```css
.tap-marker {
  position: absolute;
  width: 26px;
  height: 26px;
  transform: translate(-50%, -50%);
  border: 2px solid #ffffff;
  border-radius: 50%;
  --marker-color: #4b8f78;
  background: color-mix(in srgb, var(--marker-color) 30%, transparent);
  box-shadow:
    0 0 0 6px color-mix(in srgb, var(--marker-color) 18%, transparent),
    0 0 22px color-mix(in srgb, var(--marker-color) 74%, transparent);
  pointer-events: none;
}
```

（`.tap-marker span`、`.frame-node--ignored .tap-marker` 两段保持不变。）

- [ ] **Step 2: 追加新样式（箭头 / 环 / 徽标 / 侧栏）**

在 `styles.css` 末尾追加：

```css
/* —— kind-aware overlays —— */
.swipe-arrow {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.marker-ring {
  position: absolute;
  width: 40px;
  height: 40px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--marker-color, #e0a458);
  border-radius: 50%;
  background: color-mix(in srgb, var(--marker-color, #e0a458) 16%, transparent);
  pointer-events: none;
  animation: marker-pulse 1.4s ease-in-out infinite;
}

@keyframes marker-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--marker-color, #e0a458) 40%, transparent); }
  50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--marker-color, #e0a458) 0%, transparent); }
}

.marker-chip {
  position: absolute;
  transform: translate(-50%, 0);
  margin-top: 14px;
  padding: 2px 6px;
  border: 1px solid var(--chip-color, #a371f7);
  border-radius: 6px;
  background: color-mix(in srgb, var(--vscode-editor-background) 78%, transparent);
  color: var(--chip-color, #a371f7);
  font-family: var(--vscode-editor-font-family);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

.frame-index--kind {
  /* index badge picks up inline background from kindColor */
}

/* —— canvas + sidebar shell —— */
.canvas-body {
  position: absolute;
  top: 64px;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  gap: 10px;
}

.canvas-body .react-flow-wrapper,
.canvas-body > .flow-wrap {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  overflow: hidden;
}

.ops-sidebar {
  flex: 0 0 300px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent);
  overflow: hidden;
}

.ops-sidebar__head {
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-panel-border);
  font-size: 11px;
  font-weight: 650;
  color: var(--accent-strong);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ops-sidebar__list {
  flex: 1;
  overflow: auto;
}

.ops-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent);
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
  cursor: pointer;
}

.ops-row:hover {
  background: color-mix(in srgb, var(--vscode-button-background) 14%, transparent);
}

.ops-row--selected {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.ops-row--ignored {
  opacity: 0.5;
}

.ops-row__idx {
  width: 14px;
  color: var(--vscode-descriptionForeground);
}

.ops-row__tag {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 650;
}

.ops-row__meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-descriptionForeground);
}

.ops-row__status {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
}

.ops-empty {
  padding: 18px 12px;
  color: var(--vscode-descriptionForeground);
  font-size: 12px;
  text-align: center;
}
```

- [ ] **Step 3: 验证 webview 打包通过**

Run: `pnpm --filter @fliwright/vscode bundle:webview`
Expected: 打包成功（esbuild 不报 CSS 语法错误）。

- [ ] **Step 4: 提交**

```bash
git add packages/fliwright-vscode/src/webview/recording-canvas/styles.css
git commit -m "style(webview): kind-aware markers, swipe arrow, badge, operations sidebar"
```

---

## Task 4: 节点 kind-aware 渲染 + minimap 上色

**Files:**
- Modify: `packages/fliwright-vscode/src/webview/recording-canvas/app.tsx`（`RecordingFrameNode` 约 190 行、`FlowViewport` 的 MiniMap 约 145 行）

- [ ] **Step 1: 引入 marker-utils，删除本地 `markerPosition`**

在 `app.tsx` 顶部 import 区（`import type { ... } from './types.js';` 之后）加：

```ts
import {
  badgeLabel,
  coordLabel,
  kindColor,
  markerEndPercent,
  markerPercent,
} from './marker-utils.js';
```

删除文件里的本地函数 `markerPosition`（约 265 行整段）——它已被 `markerPercent` 取代。保留 `screenshotAspectRatio`、`ignoreReasonLabel`、`clamp`、`title`。

- [ ] **Step 2: 改写 `RecordingFrameNode`**

把 `RecordingFrameNode`（约 190-248 行整段）替换为：

```tsx
function RecordingFrameNode({ data }: NodeProps<Node<RecordingNodeData>>): JSX.Element {
  const frame = data.frame;
  const imageSrc = frame.screenshot ? `data:image/${frame.screenshot.format};base64,${frame.screenshot.base64}` : undefined;
  const color = kindColor(frame.kind);
  const start = markerPercent(frame);
  const end = markerEndPercent(frame);
  const badge = badgeLabel(frame);
  const isIgnored = frame.operationStatus === 'ignored';
  const canToggle = frame.operationIndex != null;
  const setIncluded = useCallback((included: boolean) => {
    vscode.postMessage({ type: 'setFrameIncluded', frameId: frame.id, included });
  }, [frame.id]);

  return (
    <article className={`frame-node frame-node--${frame.status}${isIgnored ? ' frame-node--ignored' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="frame-meta">
        <span className="frame-index" style={{ background: color }}>{frame.index + 1}</span>
        <span className="frame-kind">{isIgnored ? 'ignored' : frame.kind}</span>
        <span className="frame-coord">{coordLabel(frame)}</span>
      </div>
      <div className="screen-wrap" style={{ aspectRatio: screenshotAspectRatio(frame) }}>
        {imageSrc ? (
          <img src={imageSrc} alt={`Frame ${frame.index + 1}`} draggable={false} />
        ) : (
          <div className="screen-placeholder">
            {frame.status === 'error' ? 'Screenshot failed' : 'Capturing screen'}
          </div>
        )}
        {end ? (
          <svg className="swipe-arrow" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ color }}>
            <defs>
              <marker id={`ah-${frame.index}`} markerWidth="5" markerHeight="5" refX="2.5" refY="2.5" orient="auto">
                <path d="M0,0 L5,2.5 L0,5 z" fill="currentColor" />
              </marker>
            </defs>
            <line
              x1={start.x} y1={start.y} x2={end.x} y2={end.y}
              stroke="currentColor" strokeWidth={1.6} vectorEffect="non-scaling-stroke"
              markerEnd={`url(#ah-${frame.index})`}
            />
          </svg>
        ) : null}
        {frame.kind === 'longPress' && !frame.synthetic ? (
          <span className="marker-ring" style={{ left: `${start.x}%`, top: `${start.y}%`, ['--marker-color' as string]: color }} />
        ) : null}
        {!frame.synthetic ? (
          <span
            className="tap-marker"
            style={{ left: `${start.x}%`, top: `${start.y}%`, ['--marker-color' as string]: color }}
          >
            <span>{frame.index + 1}</span>
          </span>
        ) : null}
        {badge ? (
          <span
            className="marker-chip"
            style={{ left: `${start.x}%`, top: `${start.y}%`, ['--chip-color' as string]: color }}
          >
            {badge}
          </span>
        ) : null}
      </div>
      {frame.selector ? <div className="selector">{frame.selector}</div> : null}
      {frame.ignoreReason ? <div className="ignore-text">{ignoreReasonLabel(frame.ignoreReason)}</div> : null}
      {frame.screenshotError ? <div className="error-text">{frame.screenshotError}</div> : null}
      {canToggle ? (
        <div className="frame-actions" onPointerDown={(event) => event.stopPropagation()}>
          {isIgnored ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); setIncluded(true); }}>Include</button>
          ) : (
            <button type="button" onClick={(event) => { event.stopPropagation(); setIncluded(false); }}>Ignore</button>
          )}
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}
```

注意：原来的 `{frame.text ? <div className="input-preview">"{frame.text}"</div> : null}` 行已被 `marker-chip`（badge）取代，删除该行以免重复显示文本。

- [ ] **Step 3: minimap 按 kind 上色**

在 `FlowViewport` 的 `<MiniMap>`（约 145 行）把 `nodeColor` 替换为：

```tsx
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const frame = node.data?.frame as RecordingFrame | undefined;
          if (frame?.status === 'error') return '#d95f4b';
          if (!frame) return '#8a8f98';
          return kindColor(frame.kind);
        }}
      />
```

- [ ] **Step 4: 类型检查 + 打包验证**

Run: `pnpm --filter @fliwright/vscode lint && pnpm --filter @fliwright/vscode bundle:webview`
Expected: 无类型错误，webview 打包成功。

- [ ] **Step 5: 跑 vscode 单测确认无回归**

Run: `pnpm --filter @fliwright/vscode test`
Expected: 全部 PASS（含 marker-utils、RecordingPanel 等既有用例）。

- [ ] **Step 6: 提交**

```bash
git add packages/fliwright-vscode/src/webview/recording-canvas/app.tsx
git commit -m "feat(webview): render recording nodes by interaction kind, color minimap"
```

---

## Task 5: 右侧操作列表面板 + 选中联动

**Files:**
- Modify: `packages/fliwright-vscode/src/webview/recording-canvas/app.tsx`（`RecordingCanvasApp` 约 47 行、`FlowViewport` 约 104 行）

- [ ] **Step 1: 给 `RecordingCanvasApp` 加选中状态与布局**

把 `RecordingCanvasApp`（约 47-102 行）替换为（新增 `selectedId` 状态、`canvas-body` 容器、侧栏）：

```tsx
function RecordingCanvasApp(): JSX.Element {
  const [session, setSession] = useState<RecordingCanvasSession>(EMPTY_SESSION);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionToCanvasMessage>) => {
      if (event.data.type === 'session') {
        setSession({
          ...event.data.session,
          frames: event.data.session.frames ?? [],
        });
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const nodes = useMemo<Array<Node<RecordingNodeData>>>(() => (
    session.frames.map((frame, index) => ({
      id: frame.id,
      type: 'recordingFrame',
      position: { x: index * NODE_X_GAP, y: NODE_Y + (index % 2) * 28 },
      data: { frame },
      draggable: true,
      selected: frame.id === selectedId,
    }))
  ), [session.frames, selectedId]);

  const edges = useMemo<Edge[]>(() => (
    session.frames.slice(1).map((frame, index) => ({
      id: `edge-${session.frames[index].id}-${frame.id}`,
      source: session.frames[index].id,
      target: frame.id,
      type: 'smoothstep',
      animated: session.status === 'recording',
      label: `${index + 1} -> ${index + 2}`,
      style: { stroke: 'var(--flow-edge)', strokeWidth: 2 },
      labelStyle: { fill: 'var(--vscode-descriptionForeground)', fontSize: 10 },
    }))
  ), [session.frames, session.status]);

  const stopRecording = useCallback(() => vscode.postMessage({ type: 'stopRecording' }), []);
  const openSavedRecording = useCallback(() => vscode.postMessage({ type: 'openSavedRecording' }), []);

  return (
    <ReactFlowProvider>
      <div className="canvas-shell">
        <Toolbar
          session={session}
          onStop={stopRecording}
          onOpenSavedRecording={openSavedRecording}
        />
        <div className="canvas-body">
          <FlowViewport session={session} nodes={nodes} edges={edges} selectedId={selectedId} onSelect={setSelectedId} />
          <OperationsSidebar frames={session.frames} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
    </ReactFlowProvider>
  );
}
```

- [ ] **Step 2: 改 `FlowViewport` 接收并暴露选中居中**

把 `FlowViewport`（约 104-155 行）替换为（签名加 `selectedId`/`onSelect`，用 `useReactFlow` 居中）：

```tsx
function FlowViewport({
  session,
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  session: RecordingCanvasSession;
  nodes: Array<Node<RecordingNodeData>>;
  edges: Edge[];
  selectedId: string | null;
  onSelect(id: string): void;
}): JSX.Element {
  const { fitView, getNode, setCenter } = useReactFlow();

  useEffect(() => {
    window.requestAnimationFrame(() => {
      fitView({ padding: 0.24, duration: 220, maxZoom: 1.15 });
    });
  }, [fitView, nodes.length]);

  useEffect(() => {
    if (!selectedId) return;
    const node = getNode(selectedId);
    if (!node) return;
    setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + 56, { zoom: 1.1, duration: 280 });
  }, [selectedId, getNode, setCenter]);

  if (nodes.length === 0) {
    return (
      <div className="empty-canvas">
        <div className="empty-kicker">Recording canvas</div>
        <h1>{session.status === 'recording' ? 'Waiting for the first interaction' : 'Ready to capture app frames'}</h1>
        <p>Tap, swipe, long-press and text input will appear as frames as the session records.</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(event, node) => onSelect(node.id)}
      fitView
      minZoom={0.18}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--flow-grid)" />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const frame = node.data?.frame as RecordingFrame | undefined;
          if (frame?.status === 'error') return '#d95f4b';
          if (!frame) return '#8a8f98';
          return kindColor(frame.kind);
        }}
      />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
```

（注意：Task 4 已在 `FlowViewport` 改过一次 minimap；本任务整段替换 `FlowViewport`，以本步骤为准。）

- [ ] **Step 3: 新增 `OperationsSidebar` 组件**

在 `app.tsx` 中 `RecordingFrameNode` 之前新增：

```tsx
function OperationsSidebar({
  frames,
  selectedId,
  onSelect,
}: {
  frames: RecordingFrame[];
  selectedId: string | null;
  onSelect(id: string): void;
}): JSX.Element {
  return (
    <aside className="ops-sidebar">
      <div className="ops-sidebar__head">操作列表 · {frames.length}</div>
      <div className="ops-sidebar__list">
        {frames.length === 0 ? (
          <div className="ops-empty">还没有录制的操作</div>
        ) : (
          frames.map((frame) => {
            const color = kindColor(frame.kind);
            const isIgnored = frame.operationStatus === 'ignored';
            return (
              <div
                key={frame.id}
                className={`ops-row${frame.id === selectedId ? ' ops-row--selected' : ''}${isIgnored ? ' ops-row--ignored' : ''}`}
                onClick={() => onSelect(frame.id)}
              >
                <span className="ops-row__idx">{frame.index + 1}</span>
                <span className="ops-row__tag" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, color }}>
                  {frame.kind}
                </span>
                <span className="ops-row__meta">{rowMeta(frame)}</span>
                <span className="ops-row__status">{isIgnored ? '忽略' : '✓'}</span>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

function rowMeta(frame: RecordingFrame): string {
  const badge = badgeLabel(frame);
  const coord = coordLabel(frame);
  const selector = frame.selector ? ` · ${frame.selector}` : '';
  return [badge, coord].filter(Boolean).join(' · ') + selector;
}
```

- [ ] **Step 4: 类型检查 + 打包验证 + 单测**

Run: `pnpm --filter @fliwright/vscode lint && pnpm --filter @fliwright/vscode bundle:webview && pnpm --filter @fliwright/vscode test`
Expected: 无类型错误，webview 打包成功，全部单测 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/fliwright-vscode/src/webview/recording-canvas/app.tsx
git commit -m "feat(webview): add operations sidebar with click-to-center selection"
```

---

## Task 6: 真机验证（确认捕获 + 可视化）+ 全量构建

**Files:** 无（手动验证 + 构建检查）

> 这是 spec 第 7 节的判据：确认 tap/longPress/drag/type 四种是否都被捕获并正确显示。若滑动/文本未捕获，停止并触发方案 B（另起设计）。

- [ ] **Step 1: 全量构建扩展**

Run: `pnpm --filter @fliwright/vscode build`
Expected: `tsc` + `bundle` + `bundle:webview` 全部成功，生成 `dist/`。

- [ ] **Step 2: 在样本 app 真实录制（手动）**

在 VS Code 里启动扩展开发态（按 `F5` / Run Extension），对样本 app（`exio_app`）开启录制，依次执行：**① 点击一个按钮 ② 在列表上滑动/滚动 ③ 长按某元素 ④ 点击输入框并输入文本**，然后停止录制。

预期（在录制面板）：
- 画布出现 4 个节点，颜色分别为 绿 / 蓝 / 橙 / 紫。
- 滑动节点上有**蓝色方向箭头** + `↓ Npx` 徽标。
- 长按节点有**橙色脉冲环** + `⏱ Nms` 徽标。
- 输入节点（无论是否经过前置 tap）都有**紫色徽标** `⌨ "文本"`。
- 右侧操作列表列出全部操作；点行可居中对应节点。

- [ ] **Step 3: 判定 A 是否够用**

- 若 4 种交互都可见 → 本计划收尾，进入合并/PR。
- 若**滑动或文本未出现**（即使操作了）→ 捕获层有问题，停止后续合并，告知用户并另起**方案 B（Dart 捕获加固）**设计。

- [ ] **Step 4: 全量测试与 lint 收尾**

Run: `pnpm --filter @fliwright/core test && pnpm --filter @fliwright/vscode test && pnpm --filter @fliwright/core lint && pnpm --filter @fliwright/vscode lint`
Expected: 全部 PASS。

- [ ] **Step 5: 最终提交（如有遗留改动）**

```bash
git status
# 若有未提交改动：
git add -A && git commit -m "chore: finalize recording interaction visualization"
```

---

## Self-Review（计划作者已执行）

**Spec 覆盖：**
- 4.1 节点 kind-aware 渲染 → Task 2（utils）+ Task 4（节点）✓
- 4.2 独立文本输入补帧（`synthetic` 字段）→ Task 1 ✓
- 4.3 操作列表面板（右侧栏，复用 frames，零新协议）→ Task 5 ✓
- 4.4 配色一致性（节点/minimap/列表）→ Task 2 `kindColor` + Task 4 minimap + Task 5 侧栏 ✓
- 第 5 节边界（箭头裁剪靠 `.screen-wrap` overflow、文本截断、replace 标记、忽略半透明）→ Task 3 CSS + Task 2 `badgeLabel` ✓
- 第 6 节测试（独立 type 补帧、drag 帧、纯函数）→ Task 1 + Task 2 ✓
- 第 7 节验证步骤 → Task 6 ✓

**占位符扫描：** 无 TBD/TODO；每个代码步骤均含完整代码；命令含预期输出。✓

**类型一致性：** `synthetic` 字段（Task 1 定义于 `RecordingFrame`）在 Task 2 `markerPercent`/`coordLabel` 与 Task 4 节点渲染中均按 `frame.synthetic` 使用，一致。`kindColor`/`markerPercent`/`markerEndPercent`/`coordLabel`/`badgeLabel` 在 Task 2 定义，Task 4/5 引用，签名一致。`NODE_WIDTH` 为模块级常量（已存在），Task 5 引用一致。✓
