# Fliwright Cloud Theme

Cloud 将 2026-11-04 的变色龙品牌视觉应用到 shadcn/ui 的 **Mira** 紧凑布局（`radix-mira`）：青绿主操作、海军蓝深色界面、白色浅色卡片，配合清晰的成功、失败与警告状态。与 VS Code 插件共用视觉语言。

## 配色与视觉语言

| 用途 | 深色主题 | 浅色主题 | shadcn token |
| --- | --- | --- | --- |
| 页面背景 | `#0F1B2A` | `#F5F8F7` | `background` |
| 卡片 | `#152436` | `#FFFFFF` | `card` |
| 正文 | `#EAF2F5` | `#142D4E` | `foreground` |
| 次要文字 | `#A5B7C7` | `#586D7D` | `muted-foreground` |
| 主操作 | `#00BFA6` | `#007F73` | `primary` |
| 主操作文字 | `#142D4E` | `#FFFFFF` | `primary-foreground` |
| 主操作悬停 | `#28CDB7` | `#006F65` | 扩展 `primary-hover` |
| 细描边 | `#2A3D50` | `#D8E3E4` | `border` |
| 通过 | `#36D98A` | `#138346` | 扩展 `pass` |
| 失败 | `#FF7B66` | `#BF3C2E` | `destructive` / 扩展 `fail` |
| 警告 | `#FFD84D` | `#996400` | 扩展 `warn` |
| 代码背景 | `#0B1522` | `#0B1522` | 扩展 `code` |

- 品牌原色为 Cyan `#00C9D8`、Teal `#00BFA6`、Green `#36D98A`、Lime `#B7F34A`、Yellow `#FFD84D`、Navy `#142D4E`，在主题中以 `--brand-*` 声明。浅色界面的正文和操作色经过对比度调整。
- 海军蓝深色背景与白色浅色卡片、低对比度分隔线、轻阴影构成视觉层次。渐变限于变色龙 Logo，不用于按钮或面板背景。
- 顶栏与浏览器图标使用 `packages/fliwright-cloud/src/web/assets/` 中的品牌 SVG，归 Cloud 自身打包；不跨包导入 VS Code 插件资源。
- UI 字体优先 Inter，代码优先 JetBrains Mono，保留中文和系统字体回退，不加载网络字体。
- 青绿色用于主操作、链接、导航选中和焦点；排队、运行中与已完成使用低饱和背景，绿色表达通过或健康，珊瑚红表达失败。青绿、青、绿、青柠与黄组成通用图表序列；结果图表仍使用状态语义颜色。
- 状态同时保留文字和图标，不只依赖颜色。徽章使用低透明度色底与独立文字色。
- 测试结果成功/失败图标使用实心圆底配白色勾号/叉号；成功为绿色，失败为红色。在步骤列表、时间轴和测试看板中保持一致，并提供可读标签。截图、运行中等非结果状态继续使用其语义图标。
- 看板列与卡片统一使用中性描边；状态色仅用于标题图标和卡片内的小型状态胶囊，不用于列顶部或悬停边框。
- 用户明确偏好：不要使用装饰性的彩色描边、状态侧边竖条、步骤组底部彩色线或选中项外框。时间轴和步骤列表用留白、轻底色、文字及图标表达层次、状态和选中；中性分隔线只用于必要的结构分区，焦点环只在键盘导航时显示。后续新增或调整界面沿用此规则。
- 代码、日志和 Trace 使用近黑海军蓝底、等宽字体和浅色文字，行号降低强调程度。
- 基础圆角为 `0.5rem`，输入框和按钮使用 `md`（6px），面板使用 `lg`（8px）；阴影保持轻微。
- 回放画布使用低对比度网格，呼应参考图中的技术线条，不干扰截图内容。

## Mira 布局密度

- 默认按钮、输入框、选择器高 28px；小按钮 24px，大按钮 32px，标签高 20px。控件文字以 12px 为主。
- 顶栏高 48px，桌面页面边距 16px，区块间距 12px；面板内边距以 12px 为主，表单面板为 16px。
- 看板列间距 8px，卡片内边距 10px；减少标题、状态和底部信息的纵向留白，增加同屏可见任务数。
- 表单、设备页、表格、回放工具栏和检查面板沿用同一紧凑尺度；不缩放整个页面，也不压缩时间轴的时间坐标。
- 窄屏表单输入框保留 36px 高度，文本输入保留 16px 字号以避免移动浏览器自动放大；触摸设备上的操作按钮保留至少 36px 点击高度。看板继续在自身区域横向滚动。
- 组件参考：[Mira Button](https://ui.shadcn.com/r/styles/radix-mira/button.json)、[Mira Input](https://ui.shadcn.com/r/styles/radix-mira/input.json)。本地保留现有 Radix 分包、原生表单语义、引用转发和组合接口。

## shadcn 主题契约

主题唯一来源是 [`theme.css`](../packages/fliwright-cloud/src/web/theme.css)，由 Cloud 的 `style.css` 导入。

- 标准颜色以完整 OKLCH 值或语义 token 引用声明，使用 `:root` 和 `.dark` 定义浅色、深色主题。
- 包含 `background`、`foreground`、`card`、`popover`、`primary`、`secondary`、`muted`、`accent` 的前景配对，以及 `destructive`、`border`、`input`、`ring`。
- 包含 `chart-1` 至 `chart-5` 和完整 `sidebar-*` token，供后续图表和侧栏组件使用。
- Tailwind v4 的 `@theme inline` 将 token 映射为 `bg-background`、`text-primary`、`border-border` 等工具类；`dark` variant 使用标准 `.dark` 类。
- `pass`、`fail`、`warn`、`run`、`idle`、`done` 及其 `bg` / `ink` 配对，以及 `code-*`，是监控领域扩展，不替换 shadcn 标准 token。
- 首次访问默认深色；已有 `cloud-theme` 偏好继续生效。切换同步更新 `.dark`、`data-theme` 和本地偏好。
- 新增 UI 应消费语义 token，避免在组件中直接写色值。

默认主按钮文字对比度约为深色 `5.94:1`、浅色 `4.90:1`；悬停使用不透明纯色以保留文字对比度。深浅两套主题沿用相同的变量契约与切换逻辑。
