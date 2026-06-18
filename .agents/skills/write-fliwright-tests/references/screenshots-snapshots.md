# 截图与快照（Screenshots & Snapshots）

`page` 上有两种不同的能力：

- **截图（Screenshots）**（`page.screenshot()`）——把渲染出的像素捕获成 PNG `Buffer`。
- **快照（Snapshots）**（`page.snapshot()`）——捕获**语义化的控件树**，得到结构化的、可查询、可操作的一组 ref。

## 截图

### `screenshot(options?)`

```typescript
screenshot(options?: {
  pixelRatio?: number;                               // default 1.0
  mode?: 'auto' | 'boundary' | 'canvas';             // default 'auto'
  rect?: { x: number; y: number; width: number; height: number };  // crop, logical px
}): Promise<Buffer>                                   // PNG bytes
```

捕获策略：

| `mode` | 何时使用 |
| --- | --- |
| `'auto'`（默认） | 自动检测 PlatformView（WebView）并挑选最佳路径 |
| `'boundary'` | 强制走 `RepaintBoundary.toImage()`——速度快，但看不到 PlatformView 内容 |
| `'canvas'` | 强制走 `OffsetLayer` 绘制——可绕过 WebView 的 `debugNeedsPaint` 问题 |

```typescript
const png = await page.screenshot();                       // full screen
await writeFile('screen.png', png);

const region = await page.screenshot({
  pixelRatio: 2,
  mode: 'canvas',                                          // capture a WebView
  rect: { x: 0, y: 200, width: 360, height: 480 },
});
```

### `screenshotFullPage(options?)`

滚动可滚动内容、捕获多段、并拼接成一张很高的 PNG。

```typescript
screenshotFullPage(options?: { pixelRatio?: number }): Promise<Buffer>
```

> **注意：** 桥接会返回多段；多段 PNG 拼接目前尚不完整（产生多于一段时只返回第一段）。在加入拼接器依赖之前，请优先用已知滚动位置的 `screenshot()`，或预期只会得到单段。

## 快照（语义树）

### `snapshot(options?)`

返回一份交互控件的结构化快照，每个控件带有稳定的 `ref` 句柄。需要当前的桥接支持（`ext.fliwright.snap`）。

```typescript
snapshot(options?: {
  depth?: number;              // tree depth to capture
  includeRects?: boolean;      // include rect data per ref
  includeProperties?: boolean; // include widget properties
}): Promise<AgentSnapshotResult>
```

`AgentSnapshotResult.refs[]` 每个元素暴露 `{ ref, label, role, type, key, rect?, … }`。

```typescript
const snap = await page.snapshot({ depth: 4, includeRects: true });
for (const r of snap.refs) {
  console.log(r.ref, r.type, r.label, r.key);
}
```

### `ref(ref)` —— 锁定某个具体控件

对快照返回的 ref 执行操作。ref **仅在单次快照内有效**——绝不要跨运行硬编码 `e<N>`。

```typescript
ref(ref: string): Locator
```

```typescript
const first = snap.refs[0]?.ref;
if (first) await page.ref(first).click();
```

### `findRef(query)` —— 用谓词在一份新鲜快照里查找 ref

当一份新鲜快照比选择器更精确时，可以用它一步查到 ref 并对其操作。

```typescript
findRef(query: {
  text?: string; containsText?: string; key?: string;
  semanticsLabel?: string; role?: string; type?: string;
}): Promise<Locator>
```

```typescript
const confirm = await page.findRef({ text: 'Confirm', role: 'button' });
await confirm.click();
```

### 探索式工作流（当前桥接）

1. `page.snapshot({ depth, includeRects })` 查看屏幕上有什么；
2. 选一个稳定的**查询**（role + text + key），而不是某个 `e<N>` ref；
3. 提交一个有韧性的 locator：`page.getBySemantics({ label: 'Confirm', role: 'button' })`，或者在同一次运行内捕获的 `await page.findRef({ text: 'Confirm', role: 'button' })`。

MCP 工具 `fliwright_snap` / `fliwright_observe` 走的就是这条同样的快照路径——见 [mcp-workflow.md](./mcp-workflow.md)。

## 桥接能力清单

快照/ref 相关流程依赖特定的扩展。如果 VM 返回 `Unknown method "ext.fliwright.X"`，说明应用接的是更旧的桥接——先升级/重新构建它，再用该特性。

| 能力 | 所需场景 |
| --- | --- |
| `ext.fliwright.snap` | `page.snapshot()`、`page.findRef()`、MCP `fliwright_snap` / `fliwright_observe` |
| `ext.fliwright.action` | ref 支撑的 tap/type/wait，所有 `Locator` 动作，actionability 诊断 |
| `ext.fliwright.extractForm` | `page.formHelper.*`、`fill()`、`fillFields()` |
| `ext.fliwright.screenshot` | `page.screenshot()`、AI 运行报告截图 |
| `ext.fliwright.resolve` | `Locator.resolveAll()` / `count()` / `isVisible()` |
| mock 扩展（`ext.fliwright.mock.*`） | `driver.mock.*`、工具侧 mock 集成 |

## 遗留快照（更旧的桥接）

更旧的桥接暴露的是 `ext.fliwright.snapshot`（注意是 **snapshot**，不是 **snap**），返回一个扁平的 `{ widgets: [...] }` 列表，元素形如 `{ id, type, key, rect, parentType, adjacentText, description }`。`exio-app-e2e.test.ts` 演示了这条遗留兜底路径：

```typescript
const resp = await driver.sendRequest('ext.fliwright.snapshot') as { widgets?: LegacyWidget[] };
const widgets = resp.widgets ?? [];
```

请把这些脚本标注为**遗留**、保持隔离，并在应用升级桥接后迁移到 `ext.fliwright.snap`。
