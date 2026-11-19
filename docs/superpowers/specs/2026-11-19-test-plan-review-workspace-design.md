# 测试计划 Item 图文列表视图设计

状态：设计提案，尚未实现。2026-11-19。根据用户反馈，将上一版工作台方案收敛为直接解析并渲染 `items` 数组的简单列表。

## 目标

打开 `plan.json` 即可阅读图文测试计划。每个 `items[]` 元素渲染为一个可展开的 Item；保留数组顺序及现有内容结构。核心价值是把 GitLab 需求、原始附图和用例放在同一阅读上下文中。

## 界面

```text
测试计划                          plan.json · N 个 Item

▾ #488 加密货币提币流程
  16 条验收标准 · 26 个用例 · 6 个待确认问题
  查看原始 Item ↗

  ▾ 需求原文（图文）
    总流程图文字
    [完整流程图，可点击放大]
    第 1 步需求文字
    [对应 GitLab 附图]
    …
  ▸ 验收标准（16）
  ▾ 测试用例（26）
    ▾ 01 · 提币入口打开提现方式选择弹层
      AC-01 · 自动化：待编写
      用例 ID、说明
      [此用例明确引用的 GitLab 图片，可点击放大]
      前置条件
      步骤 | 操作 | 预期结果
      最终预期
    ▸ 02 · 链上提现进入所持资产选择页
    …
  ▸ 待确认问题（6）

▸ 下一个 Item
```

单栏纵向列表。Item、内容分组和用例支持原生展开/折叠；默认展开第一个 Item、图文需求、测试用例分组和第一个用例。多个 Item 使用相同布局，按源数组顺序渲染。

## 字段映射

| 数据 | 显示 |
| --- | --- |
| source.iid / title / url | Item 标题、来源链接 |
| source.description / comments | 按原顺序渲染 Markdown 文字、图片和链接 |
| acceptanceCriteria | AC 编号、正文与来源引用 |
| cases | 用例列表 |
| case.id / title / description | 用例标识、标题、说明和其中明确引用的 GitLab 图片 |
| case.acceptanceCriteria | 关联 AC 编号 |
| case.preconditions | 有序列表 |
| case.steps | 操作与预期并列；窄屏上下排列 |
| case.expectedResult | 最终预期 |
| case.automation / binding | 现有自动化覆盖状态、原因及脚本绑定 |
| openQuestions | 原文问题列表 |

界面沿用 Fliwright 的字体与深浅主题，以留白、文本、浅色填充和中性分隔线组织内容。长文本自动换行，正文可选择复制。

## GitLab 图片解析与显示

### 地址补全

根据每个 Item 的 `source.url` 取得 GitLab origin 与项目 namespace；使用已有 Item URL 解析合同，不把 `work_items/488` 当作相对地址的基目录。

对于项目 Item 的 GitLab Markdown 图片：

```text
来源 Item：
https://gitlab.com/exiogroup/exio-mobile/exio_app/-/work_items/488

原始图片地址：
/uploads/cead07b515d5b07ae78f6818be155094/image.png

用于查看原图的规范地址：
https://gitlab.com/exiogroup/exio-mobile/exio_app/-/uploads/cead07b515d5b07ae78f6818be155094/image.png
```

`/uploads/...` 是项目上传路径，不能仅使用 `new URL(path, source.url)`，否则会错误地得到主机根路径下的 `/uploads/...`。已有完整项目 uploads URL 直接保留；普通根相对链接按 origin 解析，其他相对链接按明确的来源上下文处理，不能把所有链接都套用 uploads 规则。

图片来源包括需求、评论、AC 来源引用中的 Markdown 图片，以及用例说明里明确出现的同项目 uploads 图片 URL。识别裸 URL 时正确截断末尾中文标点（如样本里的 `image.png。不设定…`）。同一段内容里去重；不根据相邻顺序猜测用例与图片关系，也不将 Item 所有图片重复附到每个用例。

### 布局与交互

- 保留文字与图片的原始顺序，图片紧跟对应说明；Markdown 图片不显示为原始语法。
- GitLab 的 `{width="515" height="397"}` 等扩展属性作为受限尺寸提示解析，不显示在正文，也不直接注入 HTML。图片保持自然比例，宽度不超过内容区域。
- 手机长图限制缩略展示高度，完整图片等比缩放、不会裁掉内容；流程横图按可用宽度展示。
- 点击图片打开大图查看，可缩放并打开 GitLab 原图。图片标题或替代文本用于加载与错误状态。
- 懒加载图片，共享同一资源缓存；折叠区域不提前拉取全部图片。
- 加载失败显示“图片加载失败 / 需要 GitLab 登录”等具体提示、重试及原图链接；保留正文。
- Figma URL 显示成可点击的设计链接。本版不增加 Figma 导出或认证链路。

### 私有图片与加载

VS Code Webview 不依赖浏览器 GitLab Cookie。由扩展端复用当前 GitLab host 的 `glab` 认证，先解析项目，再通过项目 uploads API 读取二进制图片，转为受控的 Webview 图片资源；令牌不进入 JSON、DOM 或查询参数。资源仅在扩展缓存里保存，不写入 Item 的计划目录。

2026-11-19 已对 #488 的 `cead07b515d5b07ae78f6818be155094/image.png` 做真实只读验证：项目 API 可访问，`GET /projects/:id/uploads/:secret/:filename` 返回 HTTP 200，响应包含有效 PNG 签名。实际 Content-Type 为 `application/octet-stream`，因此实现不能仅凭 Content-Type 判定失败；需结合文件签名验证并确定安全的图片类型。

认证请求仅发给匹配来源的 GitLab host / 项目，重定向不得把认证头带到外部站点；设置响应大小限制。SVG 等主动内容不直接注入页面。非项目 uploads 的外部图片不携带 GitLab 认证。group Item 的相对 uploads 若无法确定所属项目，保留链接并提示无法解析，不猜测项目。

## 范围

本版提供 Item 图文列表、图片地址补全、私有图片加载、点击放大及展开/折叠，不加入备注、评审状态、覆盖矩阵、Agent 调整包或 review.json。需要讨论时可直接引用 Item 编号和用例 ID 给 Agent。

继续使用原有 `plan.json` 合同，不修改数据、不自动刷新 GitLab、不执行测试。若在 VS Code 提供入口，可作为该 JSON 的自定义只读预览，保留文本打开方式。

渲染需保留原文、转义文本，来源外链只接受安全协议；解析或校验失败时显示错误位置，空 items 显示“暂无 Item”。自动化覆盖状态不解释成执行结果。

## 验收

- #488 展示 1 个 Item、16 条 AC、26 个用例和 6 个问题，数量及内容来自真实 JSON。
- 每个用例可展开查看完整前置条件、步骤及预期结果；折叠后仍可浏览全部标题。
- #488 原始需求的 4 张 GitLab 附图按原文顺序显示，含 1 张总流程图和 3 张页面附图；用例中明确引用的图片就近显示。
- `/uploads/...` 正确补全为项目 `/-/uploads/...` 地址，带尺寸属性的 Markdown 图片正常显示，裸图片 URL 后的中文标点不进入请求地址。
- 当前 glab 登录可读取的私有 PNG 即使 Content-Type 为 application/octet-stream 也能正常显示；未登录、无权限与资源缺失时显示可恢复的错误。
- 图片按比例展示并能点击查看完整大图，Figma 设计链接可跳转。
- 多 Item 按数组顺序展示；无需选择器或额外导航。
- 原始计划不发生修改。

本轮更新设计文档并验证私有图片 API，未修改产品代码。前一版交互预览只展示文本层级，不代表本次新增的真实图片显示能力已实现。
