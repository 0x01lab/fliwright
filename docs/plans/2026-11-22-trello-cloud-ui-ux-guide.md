# 借鉴 Trello 设计 Fliwright Cloud 的项目导航与执行看板

调研日期为 2026 年 11 月 22 日，范围是登录后的 Trello Web 工作区。Trello 在 2025 年 5 月发布新版导航，2026 年又更新了图标和卡片正面的交互。下文依据 Atlassian 的公开产品图、发布说明和现行帮助。[新版导航公告](https://www.atlassian.com/blog/trello/new-trello-is-here) · [设计团队的图标更新](https://community.atlassian.com/forums/discussion/3200667/refreshing-our-trello-icons) · [卡片正面更新](https://community.atlassian.com/forums/discussion/3227768/checklists-now-appearing-on-the-front-of-your-cards)

**Cloud 最值得借鉴的是三个入口的分工。** 想换项目，点当前项目名。想管理这个项目，使用项目内导航。想知道整个团队哪些测试正在排队、哪些失败，打开执行看板。用户在每一步都能认出当前范围，也能回到刚才的位置。

## Trello 如何管理和切换项目

| 用户意图 | Trello Web 的实际做法 |
| --- | --- |
| 组织项目 | Workspace 聚合团队的看板，一个项目可以使用一个或多个 Board。建板时指定名称和所属 Workspace，并可调整可见范围。进入看板后，板名、视图、成员、筛选和分享集中在看板标题栏。[工作区](https://support.atlassian.com/trello/docs/what-are-trello-workspaces/) · [创建看板](https://support.atlassian.com/trello/docs/creating-a-new-board/) · [看板导航](https://support.atlassian.com/trello/docs/navigation-in-trello/) |
| 从 A 板切到 B 板 | 在看板底部打开 **Switch boards**，搜索板名，也可从星标、最近或所属 Workspace 进入。按 `b` 可打开切换器，输入板名后按 `Enter` 打开匹配项，`Esc` 收起。频繁切换时可将同一个切换器固定在左侧，选择紧凑列表或缩略图网格。分组会记住展开状态。[切换操作与演示](https://support.atlassian.com/trello/docs/navigation-in-trello/) · [产品团队为何加入固定与列表视图](https://community.atlassian.com/forums/discussion/3040942/board-navigation-changes-based-on-community-feedback/p1) |
| 在当前看板找任务 | 顶栏搜索可以跨看板查找。板内筛选只收窄眼前的卡片，匹配项仍出现在原列。看板底部还可以展开 Inbox 或 Planner，与当前板并排工作。[搜索与筛选](https://support.atlassian.com/trello/docs/filtering-vs-searching/) · [面板导航](https://support.atlassian.com/trello/docs/navigation-in-trello/) |
| 维护 Kanban | 列表横向排列，每列代表团队定义的阶段或分类。成员在目标列底部添加卡片，拖动卡片调整顺序或推进阶段。2026 年 3 月发布的 Web 多选支持按住 `Shift` 点选，再从右键菜单一次移动或复制最多 20 张卡片。[看板、列表与卡片](https://trello.com/guide/trello-101) · [Web 批量操作](https://community.atlassian.com/forums/discussion/3203727/new-move-or-copy-up-to-20-cards-at-once) |
| 把卡片交给另一个项目工具跟进 | 2026 年 8 月，Trello 团队公布了从普通卡片菜单创建 Jira 工作项的入口。Chrome 和 Edge 用户可就地发起，板上同时保留原卡与关联卡，后续工作仍可从原看板找到。[产品公告](https://community.atlassian.com/forums/discussion/3280236/create-jira-work-items-right-from-trello) · [适用范围](https://support.atlassian.com/trello/docs/create-jira-work-items-from-trello-cards/) |

## 看板为什么容易扫读

| 切换器里的最近看板 | 看板里展开清单的卡片 |
| --- | --- |
| ![Trello 切换器的深色列表，星标分组已收起，最近看板按缩略图和名称逐行排列](https://us.v-cdn.net/6038660/uploads/images/393811iFB6C500D9BA20D28/e7f7b846-5053-4d71-961d-0326be2965d6.png) | ![Trello 绿色画布上的浅灰列表、白色卡片和展开的清单](https://us.v-cdn.net/6038660/uploads/images/430896i7D8E29D3C910F0E7/card-front-checklist.png) |
| 小缩略图帮助认板，名称左对齐，行高一致。收起星标区后，最近访问的板仍可直接打开。[官方切换器示例](https://community.atlassian.com/forums/discussion/3040942/board-navigation-changes-based-on-community-feedback/p1) | 画布、列、卡片用三层底色分开。标题占主行，日期、清单计数和成员共用一行。点击计数，只展开这一张卡的清单。[官方卡片示例](https://community.atlassian.com/forums/discussion/3227768/checklists-now-appearing-on-the-front-of-your-cards) |

Trello 的卡片使用柔和圆角和清晰的无衬线字，操作图标的大小和笔画粗细接近。用户可更换看板背景和卡片封面。标签可展开名称，色觉友好模式为标签加上图案。打开卡片后，添加成员、日期和清单的入口靠近标题，复制、移动等操作放进更多菜单，评论和活动可以收起。[图标前后对照](https://community.atlassian.com/forums/discussion/3200667/refreshing-our-trello-icons) · [看板背景](https://support.atlassian.com/trello/docs/changing-board-backgrounds/) · [卡片封面](https://support.atlassian.com/trello/docs/what-is-a-card-cover) · [标签显示](https://support.atlassian.com/trello/docs/adding-labels-to-cards/) · [卡片详情与配图](https://support.atlassian.com/trello/docs/new-card-back/)

## Cloud 的项目目录与切换器

在新版 Cloud 中，建议把 Trello 工作区的层级用在团队，把切换看板的交互用在切换项目。一个项目可以有多个分区，团队执行看板则汇总多个项目的运行。下面的入口和切换落点采用仓库中的导航草案，角色和可执行操作以 Cloud 现有能力为准。[项目导航设计草案与可点击草图](../superpowers/specs/2026-11-22-cloud-project-navigation-design.md) · [项目页面实现](../../packages/fliwright-cloud/src/web/Projects.tsx)

| 位置 | 用户在这里要做的事 | 建议呈现 |
| --- | --- | --- |
| 团队项目目录 `/projects` | 找到项目，或连接第一个仓库 | 显示项目名、仓库路径和默认分支，支持按名称或仓库搜索。同名项目靠仓库路径区分。管理员有「创建项目」入口，普通成员在空目录中看到「联系管理员创建项目」。 |
| 项目工作区 `/projects/<id>` | 查看用例、管理项目、跟进本项目的运行 | 左侧顶部是「所有项目」和可点击的当前项目名，下方是测试用例、运行场景、运行记录、扫描记录、项目设置。仓库配置和 Push 策略放进设置。窄屏把项目名移到内容上方，分区横向排列。 |
| 当前项目名打开的切换器 | 在当前位置直接换项目 | 打开后聚焦搜索框。结果每行显示项目名和仓库，用勾标识当前项目。支持方向键、`Enter` 和 `Esc`。有用户偏好数据时可加入「星标」「最近」分组，并保留完整目录入口。 |
| 团队执行看板 `/queue` | 跨项目查看测试进度 | 从团队导航直接到达，标题旁可「提交测试」。看板内搜索提交、分支或任务 ID，也可按应用筛选。每张卡显示能辨认来源的项目或应用名。 |

**首次管理项目。** 管理员从目录创建项目，连接仓库并确认默认分支。进入项目后，具备扫描权限的人可以启动首次扫描，正在扫描时可直接查看进度。目录可用后，成员选择扫描版本和用例，核对本次运行的提交，按需选择场景。提交成功进入本项目的运行记录。[项目导航设计草案](../superpowers/specs/2026-11-22-cloud-project-navigation-design.md)

**切换已有项目。** 假设用户正在「商城 App → 运行记录」，地址为 `/projects/storefront?view=runs`。点击「商城 App」，搜索另一个仓库，选中「商家 App」后进入 `/projects/merchant` 的测试用例页。标题、扫描版本和可用操作应同时更新，B 项目从自己的默认版本与筛选条件开始。浏览器后退应回到商城 App 的运行记录，恢复原有筛选和阅读位置。

三个搜索框可以直接写清各自的范围。「搜索项目名或仓库」查团队项目，「搜索当前版本的用例」查本项目所选扫描版本，「搜索提交、分支或任务 ID」查团队看板。新项目尚在加载时显示该项目的加载状态，取得对应版本的数据后再显示可运行的用例。

## Cloud 执行看板的列与卡片

**一张卡对应一次测试请求，同一用例的两次独立提交各占一张。** 「待测试」按调度顺序显示排队位置。「测试中」容纳分配设备、准备环境、执行、收集报告和正在取消等阶段。测试结束后按结果进入「已成功」或「已失败」，基础设施故障在失败列标明「执行异常」。已取消、已跳过等记录进入按需出现的「其他结果」。列头显示本页数量，板级汇总另标总数。[执行看板分组与排序](../../packages/fliwright-cloud/src/web/TestBoard.tsx) · [团队看板与任务详情](../../packages/fliwright-cloud/src/web/app.tsx)

一张失败卡可以这样排。以下为示例数据。

```text
商城 App · checkout                           #8d1f26be
提交订单后显示确认页
✖ 测试失败                          main · 7c3e1b2a
```

用户从标题认出用例，从状态判断是否需要处理，从来源区分同名任务。整张卡支持点击和键盘打开，跨列流转由系统更新。有本次执行的已发布报告就进入报告，可用「跳到失败步骤」查看已有的截图和日志。报告尚在收集时先显示任务动态。返回看板时应保留应用筛选、分页和滚动位置。[任务与报告路由](../../packages/fliwright-cloud/src/web/app.tsx) · [步骤回放与失败证据](../../packages/fliwright-cloud/src/web/Replay.tsx)

| 视觉决策 | Cloud 的具体做法 |
| --- | --- |
| 区分画布、列、卡片 | 分别使用 `background`、`muted`、`card`。列标题和卡片标题用字重区分。中性分隔线用于结构，选中项使用轻底色和文字，焦点环只在键盘导航时显示。 |
| 分配颜色 | 青绿 `primary` 留给主操作。排队、执行中用低饱和底色和阶段文字。通过与失败使用实心圆底的勾或叉，配明确文字及 `pass`、`fail` 语义色。列边缘保持中性。 |
| 控制密度 | 沿用 Mira。桌面顶栏 48 px，默认控件高 28 px，列间距 8 px，卡片内边距 10 px，控件与面板圆角分别为 6 px 和 8 px。界面使用 Inter 与中文回退，提交号和日志使用等宽字体。 |
| 适配窄屏 | 看板在自身区域横向滚动。长项目名和卡片标题允许换行，操作仍可触达。窄屏输入框高 36 px、字号 16 px，触屏按钮点击高度至少 36 px。 |

这些尺寸、颜色和字体来自 Fliwright Cloud。组件复用现有 shadcn/ui 与语义 token，深浅主题使用同一组变量名。[Cloud 主题规范](../fliwright-theme.md) · [主题变量](../../packages/fliwright-cloud/src/web/theme.css)

## 可直接交给 Agent 的设计任务

```text
请阅读仓库中的 docs/plans/2026-11-22-trello-cloud-ui-ux-guide.md 和 docs/fliwright-theme.md，
为 Fliwright Cloud 设计项目目录、项目工作区的切换器和团队执行看板。

用两个名称相近、仓库不同的项目，演示从 A 项目的运行记录切到 B 项目的测试用例，
再从团队看板打开一条失败运行。让用户能辨认当前项目、分区和搜索范围。
切换器支持键盘选择，后退能恢复原位置。看板列由服务端状态决定，每张卡对应一次测试请求。
卡上呈现用例名、来源、阶段或结果以及版本，详情承载失败证据。
操作入口与现有角色权限、导航设计和数据字段一致。

交付桌面和窄屏布局，覆盖深浅主题，按指南末尾的场景逐项验收。
```

| 走查场景 | 通过条件 |
| --- | --- |
| 用键盘切换两个同名项目 | 仓库路径可区分。`Esc` 关闭后焦点回到项目名。选中另一项后标题、地址和数据一起更新，后退可回到原分区，刷新仍在当前项目和分区。 |
| 管理空项目 | 管理员在空目录能创建项目，普通成员能看到相应提示。已有项目缺少测试目录时，有扫描权限的人可启动首次扫描。搜索无结果时可以清除筛选。 |
| 跟进同一条运行 | 任务从等待设备进入执行，卡片归入对应列。执行中即使已有部分结果仍显示执行阶段。分页或筛选后，列计数与本页可见卡片一致。 |
| 排查失败并返回 | 能区分「测试失败」与「执行异常」。有报告可打开步骤证据，尚无报告可查看任务动态，返回时仍能找到刚才筛选的那组任务。 |
| 在窄屏或深色主题操作 | 页面主体稳定，滑动看板能看到后面的列。项目切换、筛选和打开卡片均可用触摸或键盘完成，用灰度显示仍能从文字与图标分辨结果。 |
