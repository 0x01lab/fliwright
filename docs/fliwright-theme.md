# Fliwright Cloud Theme

Cloud 使用 shadcn/ui 的 **Mira** 紧凑布局风格（`radix-mira`），采用中性灰底色与分层卡片，蓝色作为交互焦点，红绿表达测试失败和成功。配色延续用户提供的监控产品视觉参考，以下颜色是归纳后的设计值，不是原产品的官方品牌规范。

## 配色与视觉语言

| 用途 | 深色主题 | 浅色主题 | shadcn token |
| --- | --- | --- | --- |
| 页面背景 | `#141414` | `#FAFAFA` | `background` |
| 卡片 | `#1C1C1C` | `#FFFFFF` | `card` |
| 正文 | `#EDEDED` | `#171717` | `foreground` |
| 次要文字 | `#A3A3A3` | `#666666` | `muted-foreground` |
| 主操作 | `#3B82F6` | `#2563EB` | `primary` |
| 主操作文字 | `#0A0A0A` | `#FFFFFF` | `primary-foreground` |
| 细描边 | `#333333` | `#E0E0E0` | `border` |
| 通过 | `#23C770` | `#138346` | 扩展 `pass` |
| 失败 | `#FF5265` | `#D72F43` | `destructive` / 扩展 `fail` |
| 警告 | `#EAC15B` | `#996400` | 扩展 `warn` |
| 代码背景 | `#101010` | `#101010` | 扩展 `code` |

- 中性炭灰背景、分层卡片、细描边和轻阴影构成开发者监控控制台的视觉层次。
- 蓝色仅用于主操作、链接、选中和焦点；排队、运行中与已完成使用中性色，绿色只表达通过或健康，红色表达失败。
- 状态同时保留文字和图标，不只依赖颜色。徽章使用低透明度色底与独立文字色。
- 测试结果成功/失败图标使用实心圆底配白色勾号/叉号；成功为绿色，失败为红色。在步骤列表、时间轴和测试看板中保持一致，并提供可读标签。截图、运行中等非结果状态继续使用其语义图标。
- 看板列与卡片统一使用中性描边；状态色仅用于标题图标和卡片内的小型状态胶囊，不用于列顶部或悬停边框。
- 用户明确偏好：不要使用装饰性的彩色描边、状态侧边竖条、步骤组底部彩色线或选中项外框。时间轴和步骤列表用留白、轻底色、文字及图标表达层次、状态和选中；中性分隔线只用于必要的结构分区，焦点环只在键盘导航时显示。后续新增或调整界面沿用此规则。
- 代码、日志和 Trace 使用近黑中性底、等宽字体和浅色文字，行号降低强调程度。
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

默认主按钮文字对比度约为深色 `5.38:1`、浅色 `5.17:1`。中性背景不带蓝色色相，蓝色只在交互位置出现。
