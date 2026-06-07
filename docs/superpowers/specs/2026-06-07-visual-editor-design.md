# Fliwright 可视化测试编辑器设计

> 日期：2026-06-07
> 状态：Approved
> 范围：VS Code 扩展内的可视化测试编辑器（Fliwright Test Editor Tab）

## 1. 背景

Fliwright 已具备完整的 E2E 测试能力：录制、代码生成、自愈引擎、Mock 管理、VS Code 扩展集成。但测试的审核和调试仍然依赖纯代码视图，缺少一个直观的可视化界面。

本设计为 VS Code 扩展新增一个 **Fliwright Test Editor Tab**——一个基于 Webview 的自定义编辑器，以时间轴方式展示测试步骤，支持截图预览、断言详情、自愈建议，并整合替代现有的 RecordingPanel 和 FailurePanel。

## 2. 设计约束

| 维度 | 决定 |
|------|------|
| 主用户 | AI Agent（MCP 驱动），人类审核微调 |
| 使用场景 | 审核步骤 + 调试失败 + 管理套件 |
| 位置 | 混合模式：侧栏简化视图 + 编辑区完整 Tab |
| 数据格式 | 代码内注解（TS 代码中的 `@fliwright-step` 注释） |
| 交互粒度 | 语义操作级，可展开到原子操作 |
| AI 交互 | 只读镜像，被动展示 AI 操作结果 |
| 步骤信息 | 截图 + Mock/网络状态 + 断言结果 |

## 3. 代码注解格式

在 TypeScript 测试代码中用特殊注释标记语义步骤边界：

```typescript
test('购物流程', async ({ page }) => {
  // @fliwright-step: {"name":"填写登录表单","screenshot":"snapshots/step-1.png"}

  await page.locator({ text: '手机号' }).fill('13800138000');
  await page.locator({ text: '密码' }).fill('Password123!');
  await page.locator({ text: '登录' }).click();

  // @fliwright-step: {"name":"浏览商品列表","screenshot":"snapshots/step-2.png"}

  await page.locator({ text: '商品列表' }).scroll({ dy: 300 });
  await page.locator({ text: '商品卡片' }).tap();
  await expect(page.locator({ text: '商品详情' })).toBeVisible();

  // @fliwright-step: {"name":"确认支付","screenshot":"snapshots/step-3.png","status":"failed","error":"AssertionError: ..."}

  await page.locator({ text: '确认支付' }).click();
});
```

**规则：**

- `@fliwright-step` 注释是单行 JSON，记录该语义步骤的元数据
- 注释之后到下一个 `@fliwright-step`（或函数结束）之间的代码，就是该步骤的原子操作
- 截图路径存 `.fliwright/snapshots/` 下，和现有快照系统一致
- `//` 注释是合法 JS/TS，不影响代码执行
- AI Agent 和 Recorder 自动生成这些注释，人类可手动添加/编辑
- 编辑器解析 TS 文件中的 `@fliwright-step` 注解构建步骤列表

## 4. 编辑器布局

**方案 A：时间轴式**

```
┌─────────────────────────────────────────────────────────┐
│  [▶ Run] [⏺ Record] [🐛 Debug]         12 steps · 2m  │  ← 工具栏
├──────────────────┬──────────────────────────────────────┤
│  Step Timeline   │  Screenshot Viewer                   │
│                  │                                      │
│  ✓ 填写登录表单  │         ┌──────────┐                 │
│    3 子操作      │         │  📱       │                 │
│                  │         │  Flutter  │                 │
│  ▼ 浏览商品列表  │         │  App      │                 │
│    ├ scroll ↓300 │         │  截图     │                 │
│    ├ tap 商品    │         │          │                 │
│    ├ assert ⚠   │         └──────────┘                 │
│    ├ scroll ↓500 │                                      │
│    └ tap 加入购物│──────────────────────────────────────│
│                  │  [Code] [Network] [Assertions] [Heal]│  ← Tab 切换
│  ✗ 确认支付      │  // @fliwright-step: {...}           │
│    2 子操作      │  await page.locator(...).scroll();   │
│                  │  await page.locator(...).tap();       │
│  4 返回首页      │  await expect(...).toBeVisible();    │
│    2 子操作      │                                      │
├──────────────────┴──────────────────────────────────────┤
```

**左侧面板（380px）：**
- 顶部工具栏：Run / Record / Debug Last Run + 步骤统计
- 语义步骤卡片列表（可滚动，虚拟滚动优化）
- 每个卡片显示：步骤编号、语义名称、子操作数、耗时、状态（✓/✗/⚠）
- 展开后显示原子操作列表：action 类型（code 标签）+ selector/参数 + 状态色点

**右侧上方：**
- Flutter app 截图（保持手机比例），高亮当前操作的目标 widget
- 步骤间切换时截图更新

**右侧下方（140px）：**
- Code Tab：带语法着色的代码片段（当前步骤对应的注解和代码行）
- Network Tab：该步骤激活的 mock 规则、拦截的 API 请求/响应
- Assertions Tab：断言详情、通过/失败状态、错误信息
- Healing Tab：自愈引擎建议的 selector 替代方案 + Apply 按钮

## 5. 架构

### 5.1 文件结构

```
fliwright-vscode/src/
├── editor/                          # 新增：可视化编辑器模块
│   ├── TestEditorProvider.ts        # VS Code CustomEditorProvider 注册
│   ├── TestEditorPanel.ts           # Webview 生命周期管理
│   ├── AnnotationParser.ts          # 解析 TS 代码中的 @fliwright-step 注解
│   ├── AnnotationWriter.ts          # 把编辑器的修改写回 TS 代码
│   ├── EditorBridge.ts              # 桥接录制/运行事件到编辑器
│   └── panels/                      # Webview 内部 UI 组件
│       ├── StepTimeline.ts          # 左侧步骤时间轴
│       ├── ScreenshotViewer.ts      # 右侧截图预览
│       ├── DetailPanel.ts           # 底部详情（内含 4 个 Tab）
│       └── Toolbar.ts               # 顶部工具栏
```

### 5.2 数据流

```
TS 文件 (带 @fliwright-step 注解)
         │
         ▼
  AnnotationParser.parse()
         │
         ▼
  StepModel[] ──────────────────► Webview (步骤时间轴 + 截图 + 详情)
    │                                │
    │   用户在编辑器中微调              │   用户修改步骤名称/删除步骤
    │                                │
    ▼                                ▼
  AnnotationWriter.apply()  ◄──── Webview postMessage
         │
         ▼
  TS 文件更新（保留业务代码，只改注解和顺序）
```

### 5.3 核心原则

- **代码是 source of truth** — 所有数据存在 TS 文件中，无额外数据库或状态文件
- **解析器单向依赖** — AnnotationParser 只读代码，AnnotationWriter 只改注解部分，不碰业务代码
- **Webview 无状态** — 每次打开 Tab 都从文件重新解析，不缓存
- **文件监听** — 监听 TS 文件外部变更（AI 通过 MCP 修改代码），弹出提示让用户选择刷新

### 5.4 CustomEditorProvider 注册

- 文件路径匹配 `**/*.test.ts` 或 `**/*.spec.ts` 且包含 `@fliwright-step` 注解时，VS Code 提供 "Open with → Fliwright Test Editor" 选项
- 侧栏 Tests 视图中双击测试项也打开此编辑器
- 无注解的普通测试文件显示引导界面（录制生成 / AI 分析自动添加）

## 6. Webview 技术栈

| 选择 | 方案 | 理由 |
|------|------|------|
| 框架 | 纯 HTML/CSS/JS | VS Code Webview 限制，避免打包复杂度，和现有面板一致 |
| 代码着色 | CSS 类 + VS Code 主题色 | 不引入 Monaco（太重），底部 Code Tab 用简单着色 |
| 截图展示 | `<img>` + CSS transform 缩放 | 手机截图直接用 img，CSS 保持手机比例 |
| 通信 | `postMessage` 双向 | VS Code Webview 标准模式 |

### 6.1 postMessage 通信协议

```typescript
// Extension → Webview
type ExtToWebview =
  | { type: 'init'; steps: StepModel[]; code: string }
  | { type: 'step-updated'; index: number; step: StepModel }
  | { type: 'step-added'; step: StepModel }
  | { type: 'run-status'; stepIndex: number; status: 'pass' | 'fail'; error?: string }
  | { type: 'live-mode'; active: boolean }

// Webview → Extension
type WebviewToExt =
  | { type: 'select-step'; index: number }
  | { type: 'toggle-expand'; index: number }
  | { type: 'edit-step-name'; index: number; name: string }
  | { type: 'delete-step'; index: number }
  | { type: 'edit-code'; code: string }
  | { type: 'apply-healing'; stepIndex: number; healedSelector: string }
  | { type: 'run-test' }
  | { type: 'open-source' }
```

## 7. AI Agent 只读镜像集成

### 7.1 架构

```
AI Agent (MCP Tools)  ──►  Fliwright Core  ──►  EditorBridge  ──►  编辑器 Tab
（现有 16 个工具）        （Driver/Recorder）    （新增桥接层）     （被动刷新）
```

AI Agent 继续使用现有 MCP 工具操作 Flutter app，编辑器被动展示操作过程和结果。

### 7.2 EditorBridge 接口

```typescript
class EditorBridge {
  attach(editor: TestEditorPanel): void;
  detach(): void;

  // 从 RecorderService 接收事件
  onCodeGenerated(code: string, steps: StepModel[]): void;
  onStepRecorded(step: AtomicStep, screenshot?: Buffer): void;

  // 从 VitestRunner 接收运行结果
  onStepResult(stepIndex: number, result: StepResult): void;
  onRunComplete(summary: RunSummary): void;
}
```

### 7.3 只读约束

- 编辑器在录制/运行期间进入只读模式（工具栏显示 ⏺ LIVE 指示器）
- 步骤列表实时追加，截图实时刷新，但用户不能编辑
- 录制/运行结束后切回可编辑状态

## 8. 面板整合

### 8.1 功能映射

| 现有面板 | 功能 | 新编辑器位置 |
|---------|------|-------------|
| RecordingPanel | 录制状态 | 工具栏 LIVE 指示器 + 步骤实时追加 |
| RecordingPanel | 代码预览 | 底部 Code Tab |
| RecordingPanel | Insert Test | 录制结束自动保存为带注解的 TS 文件 |
| FailurePanel | 失败截图 | ScreenshotViewer（自动定位失败步骤） |
| FailurePanel | Widget 树 | 底部 Healing Tab |
| FailurePanel | 错误详情 | 底部 Assertions Tab |
| FailurePanel | 自愈建议 | 底部 Healing Tab + Apply 按钮 |

### 8.2 迁移策略

1. **Phase 1** — 编辑器 Tab 独立开发，不动现有 `webview/` 代码
2. **Phase 2** — 编辑器覆盖所有功能后，将 `startRecording` 和 `showFailure` 命令重定向到打开编辑器 Tab
3. **Phase 3** — 确认无回归后删除 `webview/RecordingPanel.ts` 和 `webview/FailurePanel.ts`

### 8.3 命令重定向

```typescript
// startRecording → 打开编辑器 Tab + LIVE 模式
vscode.commands.registerCommand('fliwright.startRecording', async () => {
  await recorderService.startRecording(targetUri);
  await vscode.commands.executeCommand('vscode.openWith', targetUri, 'fliwright.testEditor');
  editorBridge.setLiveMode(true);
});

// showFailure → 打开编辑器 Tab + 定位失败步骤
vscode.commands.registerCommand('fliwright.showFailure', async (context) => {
  await vscode.commands.executeCommand('vscode.openWith', context.testFileUri, 'fliwright.testEditor');
  editor.postMessage({ type: 'navigate-to-failure', stepIndex: context.failedStepIndex });
});
```

## 9. 侧栏增强

### 9.1 Tests 视图

```
侧栏 Tests 视图（增强后）
├── 📂 login.test.ts         → 双击打开编辑器 Tab
│   ├── ✓ 购物流程            → 点击跳到对应步骤
│   └── ✗ 支付流程            → 失败测试红色标识
├── 📂 form-fill.test.ts
│   └── ✓ 表单自动填充
└── 📂 navigation.test.ts
    └── ✓ 路由导航测试
```

### 9.2 右键菜单

- `Run Test` — 运行单个测试
- `Debug Last Run` — 打开编辑器 Tab 并定位到失败步骤
- `Re-record` — 重新录制该测试
- `Export to Dart` — 导出为 Dart integration_test 格式

## 10. 交互流程

### 10.1 审核 AI 生成的测试

1. AI Agent 通过 MCP 操作 app → Recorder 自动生成 TS 代码（带 `@fliwright-step`）
2. 侧栏 Tests 视图出现新测试（带 ⏺ 标记）
3. 用户双击 → 打开编辑器 Tab
4. 从上到下浏览语义步骤，展开查看子步骤
5. 点击截图缩略图查看大图
6. 发现问题 → 底部 Code Tab → 编辑注解或代码
7. Ctrl+S 保存 → 编辑器重新解析刷新

### 10.2 调试失败的测试

1. 运行测试失败 → 侧栏 Runs 视图显示失败条目
2. 点击 "Debug Last Run" → 打开编辑器 Tab
3. 失败步骤自动展开，红色高亮
4. 底部 Assertions Tab → 查看断言详情和错误信息
5. Healing Tab → 查看自愈引擎建议的 selector 替代方案
6. 点击 "Apply Healed Selector" → AnnotationWriter 更新代码
7. 重新运行验证

### 10.3 管理测试套件

1. 侧栏 Tests 视图 → 拖拽排列测试顺序
2. 右键测试文件 → "Add to Suite" → 选择/创建测试套件
3. 套件信息存 `.fliwright/suites/*.json`
4. 套件可设置运行配置（mock profile、device target）
5. 从侧栏一键运行整个套件

## 11. 错误处理与边界情况

| 场景 | 处理方式 |
|------|---------|
| 代码被外部修改 | FileSystemWatcher 监听 → 弹出 "文件已被外部修改，点击刷新" |
| 注解格式损坏 | 该步骤显示 "⚠ 注解格式错误"，点击跳转到对应行手动修复 |
| 截图文件缺失 | ScreenshotViewer 显示灰色占位符 "No screenshot" |
| 无注解的普通测试文件 | 显示引导界面：录制生成 / AI 分析自动添加 |
| 大量步骤（100+） | StepTimeline 虚拟滚动，截图懒加载 |
| 并发编辑冲突 | LIVE 模式只读；非 LIVE 模式检测到外部修改弹出冲突提示 |

## 12. 测试策略

| 层级 | 范围 | 方法 |
|------|------|------|
| 单元 | AnnotationParser / AnnotationWriter | 纯函数测试：给定代码字符串 → 验证解析结果；验证写回只改注解 |
| 单元 | EditorBridge 事件转发 | Mock RecorderService/Runner 事件 → 验证 postMessage 消息正确 |
| 集成 | CustomEditorProvider 生命周期 | VS Code 扩展测试框架：验证打开/关闭/保存 Tab |
| 集成 | Webview ↔ Extension 通信 | 模拟 postMessage → 验证步骤选择、编辑、删除端到端流程 |
| 集成 | 录制 → 编辑器实时更新 | 真实 RecorderService → 验证步骤列表实时追加 |
| E2E | 完整用户流程 | VS Code 扩展 host：审核 → 微调 → 运行 → 调试 → 自愈 |

### 关键测试用例

```typescript
describe('AnnotationParser', () => {
  it('从 TS 代码中提取 @fliwright-step 注解和步骤');
  it('处理无注解的普通文件（返回空数组）');
  it('处理损坏的注解 JSON（标记为解析错误）');
  it('步骤之间的代码行号范围正确');
});

describe('AnnotationWriter', () => {
  it('修改步骤名称时只改注解 JSON，不动业务代码');
  it('删除步骤时移除注解和对应代码行');
  it('保持原有缩进和格式');
});

describe('EditorBridge', () => {
  it('录制事件转发为 step-added 消息');
  it('运行结果转发为 run-status 消息');
  it('LIVE 模式下编辑器为只读');
});
```

## 13. 实现优先级

1. AnnotationParser + AnnotationWriter（核心数据层）
2. TestEditorProvider + TestEditorPanel（编辑器生命周期）
3. StepTimeline + ScreenshotViewer（核心 UI）
4. DetailPanel 4 个 Tab（详情展示）
5. EditorBridge（录制/运行实时更新）
6. 侧栏 Tests 视图增强
7. 命令重定向 + 面板清理
