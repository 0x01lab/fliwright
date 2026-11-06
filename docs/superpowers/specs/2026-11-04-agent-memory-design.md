# Fliwright Agent Memory：由 Skill 驱动的操作经验积累

日期：2026-11-04（America/Los_Angeles）

状态：已按 Skill 优先方向重新设计，尚未实现。本次只更新设计文档。

## 1. 设计决定与交付目标

新增 `fliwright-agent-memory` Skill，定义记忆的读取、收集、清洗、保存和更新规则，由执行任务的 AI Agent 完成这些工作。Agent 已经知道自己调用过哪些 CLI 命令、传入了什么参数、返回了什么结果，因此可以直接利用当前上下文提炼操作经验。

首版交付是 **一个 Skill + 目标项目中的持久记忆文件 + 既有工作流的加载指引**。不新增 Memory CLI 命令，不给 Core、connection worker 或 Dart bridge 添加采集 hook，不新增模型服务、数据库或依赖。原设计中的 `memory begin/recall/finish`、Core AgentMemory module 和自动事件聚合不再属于实施前提。

用户第一次要求“修改昵称”时，Agent 正常探索和操作；任务结束后，按 Skill 把有复用价值的入口、页面特征、目标定位、前置条件和成功检查整理成文件。换一个聊天或进程后，Agent 从同一目标项目读取这些文件，核验当前 UI，再使用已有经验完成任务。

记忆提供可供推理的经验，不是顺序执行的脚本。Agent 可以从当前页面开始，也可以复用“进入编辑资料页”这段知识去完成“修改头像”。业务目标和每一步是否适用，仍由 Agent 结合当前页面判断。

交付标准是减少重复源码检索和无目标探索，并且计入记忆维护开销后仍有净收益。文件数量、日志条数或“每次任务都写了总结”不能作为成功标准。

## 2. 职责与触发机制

| 角色 | 职责 |
| --- | --- |
| Memory Skill | 规定何时读写、字段格式、证据要求、清洗规则、存储位置、去重与失效处理，以及写入后的检查步骤。 |
| 当前 AI Agent | 读取记忆；理解自己的 CLI 调用与结果；选择值得记录的知识；提炼、脱敏、核验并通过现有文件工具落盘。 |
| 现有 Fliwright CLI | 提供 snapshot/find/observe/interact、状态查询与既有 artifacts；按现有契约操作 App，不负责新增 Memory 生命周期。 |
| 项目文件系统 | 保存跨聊天、跨进程可读的经验。聊天上下文本身不是持久存储。 |

### 2.1 Skill 如何被加载

新 Skill 的 description 明确适用场景：使用 Fliwright 探索或操作 App、复用业务入口与元素知识、任务结束后积累操作经验。现有 `fliwright-cli-workflows` 增加配套规则：进入此类任务时加载 Memory Skill，开始前检索，结束前整理，长任务在阶段性完成时检查点保存。

首次可由用户显式调用新 Skill，或由 Agent 根据可用 Skill 描述与工作流指引加载；后续不要求用户每次提醒“记住这次操作”。仅在磁盘上放一个 SKILL.md 并不等于所有 Agent 都会加载它，分发与现有工作流中的引用属于交付内容。

这里的“自动”指 Agent 遵循 Skill 自行完成读写，不需要逐步询问用户。它不是后台定时器或 CLI 回调；Skill 未加载、Agent 未遵循规则或聊天突然终止时，不承诺写入一定发生。试验必须记录漏读、漏写情况。

### 2.2 触发时机

| 时机 | Agent 执行的记忆工作 |
| --- | --- |
| 收到新的 App 操作任务 | 确认目标项目，读取小索引，按意图、页面和适用条件检索少量条目。 |
| 每次 CLI 返回后 | 在当前上下文中理解命令及结果，保留关键发现；默认不为每次点击追加文件，也不重复调用 AI 服务。 |
| 找到重要入口、解决高成本定位，或完成一个可复用子任务 | 若任务较长，将关键事实写入独立 draft 检查点，避免只依赖长上下文。短任务可以直接在结束时写正式条目。 |
| 完成、失败或正常结束任务，发送最终回复之前 | 检查实际结果，从调用历史或 draft 提炼经验，清洗、去重、保存并重读；没有值得复用的新知识则不写。 |
| 复用时发现旧经验不适用 | 现场观察，区分环境问题与知识失效，修正或标记对应条目。 |

任务边界由用户意图和 Agent 当前工作范围确定，不新增 CLI taskId。一个聊天可以有多个独立任务；“进入资料页”可以作为较长任务中的检查点。用户明确要求停止或不保存时，以用户指令为准。

## 3. 一次完整工作流

1. **定位项目。** 使用正在操作的 App 项目根目录，而不是 Fliwright 工具仓库。规范化路径；确认平台、语言、可得的 App 身份与 named scenario。未知信息明确记为 unknown，不从任务标题推断登录状态。
2. **先读记忆。** 读取索引，通过关键词、别名、页面名称和稳定 Key 查找，最多加载 3–5 个最相关条目。没有目录或没有命中就正常探索，不能为建立空库延迟任务。
3. **核验再使用。** 用当前 snapshot/find/observe 确认页面和目标。优先复用入口和稳定定位；历史经验不能证明此刻 UI、登录状态或 App 数据仍相同。
4. **正常执行。** 沿用现有 CLI 和 session 生命周期。Agent 直接利用自己的调用参数及返回值，不要求额外写一遍完整操作日志。
5. **核实结果。** 区分“命令已发出”“CLI 确认动作完成”“页面出现预期变化”和“业务目标检查通过”。证据不足时保留未知，不能把 exit code 0 当成业务成功。
6. **提炼与写入。** 在任务结束前运行第 5 节的清洗流程，复用或更新已有条目；真正新增的知识才新建文件。落盘后重读确认，再在任务回复中简要说明新增或更新了什么。

响应丢失或动作结果不确定时，继续使用现有 session status/operationId 恢复流程，不根据记忆推断动作未发生，也不为了补齐记录再次点击。已有 canonical run/artifacts 保持原职责。

## 4. 记忆存储与格式

### 4.1 项目内存储

首版固定在目标 App 项目的 `.fliwright/memory/`，不要求 Agent 调用内部 runtimeRoot 解析代码。相同项目的新聊天和新进程通过文件共享经验；不同项目、clone 或 worktree 默认拥有各自记忆，不自动互通。

```text
<target-project>/.fliwright/memory/
  index.md
  entries/<memory-id>.json
  drafts/<task-id>.json
```

- `entries` 是知识来源；一个条目是一段可复用任务、导航片段或定位经验，不预建 Page/Element/Transition/Task 四层图谱。
- `index.md` 只保留 id、标题、别名、页面、scope、状态和相对文件路径，是可重建的检索目录，不复制完整步骤与证据。
- `drafts` 仅用于长任务检查点；内容也必须先脱敏。未结束的 draft 不能被当作成功经验直接复用。
- draft 使用 taskId、intent、scope、status、findings、pendingChecks、updatedOn 保存任务范围、已知事实与待验证问题；不复制完整调用日志。status 为 active/interrupted，正常整理完成后移除 draft。
- 默认作为项目本地数据，在实际接入时加入目标项目的 Git 忽略规则；本设计不自动发布或提交用户的操作记忆。团队共享留待明确需求。
- Skill 安装目录只保存规则和模板；更新或重装 Skill 不得清空 `.fliwright/memory/`。

### 4.2 最小条目

采用 JSON，便于 Agent 阅读、精确编辑和通过通用工具检查语法。字段模板由 Skill 随附；不增加专用保存脚本或 Memory 命令。

以下页面与 Key 均为示意，不代表 Exio 当前实现。e1/e2 是条目内部引用，只有真实 CLI 返回的 requestId/operationId 才能作为外部标识写入，不能编造。

```json
{
  "schemaVersion": 1,
  "id": "edit-nickname",
  "revision": 1,
  "kind": "task",
  "title": "修改昵称",
  "aliases": ["更改昵称", "编辑个人资料中的昵称"],
  "scope": {
    "appId": "example.app",
    "platform": "android",
    "locale": "zh-CN"
  },
  "preconditions": [
    { "name": "auth", "value": "authenticated", "basis": "observed" }
  ],
  "pages": [
    { "name": "profile", "landmarks": ["profile-edit-entry"] },
    { "name": "edit-profile", "landmarks": ["nickname-input", "profile-save"] }
  ],
  "steps": [
    {
      "page": "profile",
      "target": { "key": "profile-edit-entry" },
      "action": "tap",
      "expectedPage": "edit-profile",
      "evidence": ["e1"]
    },
    {
      "page": "edit-profile",
      "target": { "key": "nickname-input" },
      "action": "fill",
      "parameter": "nickname",
      "evidence": ["e2"]
    },
    {
      "page": "edit-profile",
      "target": { "key": "profile-save" },
      "action": "tap",
      "evidence": ["e3"]
    }
  ],
  "goal": {
    "description": "重新进入资料页后，昵称等于本次任务的 nickname 参数",
    "evidence": ["e4"]
  },
  "lifecycle": "usable",
  "verification": {
    "level": "goal-checked",
    "assessedBy": "agent",
    "checkedOn": "2026-11-04"
  },
  "evidence": [
    {
      "id": "e1",
      "source": "cli-result",
      "command": "app.snapshot",
      "summary": "点击入口后观察到编辑页的昵称输入框与保存按钮"
    },
    {
      "id": "e2",
      "source": "cli-result",
      "command": "app.interact",
      "summary": "向昵称输入框填写本次参数，CLI 确认动作完成；不保存实际输入值"
    },
    {
      "id": "e3",
      "source": "cli-result",
      "command": "app.interact",
      "summary": "点击保存按钮，CLI 确认动作完成；此时尚不声称业务目标通过"
    },
    {
      "id": "e4",
      "source": "cli-result",
      "command": "app.snapshot",
      "summary": "重新进入资料页，Agent 已将实际显示值与本次参数比较，结果一致"
    }
  ],
  "pitfalls": [],
  "updatedOn": "2026-11-04"
}
```

`kind` 首版支持 task/navigation/element；共享入口可以单独保存为 navigation，也可通过 pages/aliases 从任务条目中检索，不要求维护引用图。`target` 只保存实际观察到的稳定字段及必要页面限定，不把示例字段当作新增 CLI 输入 schema。

各类条目共用 schemaVersion、id、revision、kind、title、aliases、scope、lifecycle、verification、evidence、updatedOn。task/navigation 补充 pages 和 steps，task 增加 goal；element 补充所属页面、target 和适用动作。id 一旦分配保持稳定，不把标题当作唯一身份；不同 scope 分配不同 id。首版的字段约束由 Skill 模板与格式说明统一定义。

`verification.level` 为 unverified/observed/goal-checked，分别表示待核验、观察到局部事实、明确目标检查通过。`assessedBy: agent` 表明这是 Agent 根据实际工具结果作出的记录，不是 Core 校验或机器签名。

条目可只覆盖局部知识。任务失败也能保存已观察到的导航或元素经验，但不能给整条任务设置 goal-checked。需要保存失败原因时写入经过脱敏的 pitfalls，并注明依据与适用条件。

### 4.3 证据边界

证据摘要由 Agent 从当前调用历史或 draft 提炼。存在可引用的 run/artifact 时保存真实引用；只有聊天内结果时明确是 Agent 记录的摘要，不宣称后续可以自动回放核验原始证据。artifact 丢失不意味着知识立即错误，但必须撤掉“可追溯原始证据”的表述。

源代码中发现的 Key/路由只能标为 source-code 或待核验线索，不能冒充现场观察。调用成功不等于目标成功；保存提示和重新进入页面确认值也必须作为不同强度的检查描述。

## 5. Skill 定义的清洗与写入规则

总结与清洗由当前 Agent 的推理能力完成，写文件由已有文件系统工具完成。没有第二个 AI 服务，也没有后台摘要任务。

1. **选择复用价值。** 优先保存难发现的业务入口、稳定页面地标、目标定位、必要前置条件、明确成功检查及已证实的陷阱。跳过普通逐次点击流水账、重复观察和没有新知识的成功记录。
2. **核对依据。** 每个关键结论回看实际命令结果或检查点。只知道发出了命令时，不写成已完成；上下文已经丢失且无法核实时，省略结论或降为候选，不能补造证据。
3. **归纳路径。** 删除失败尝试、调试噪声和无关源码片段，保留真正用到的导航与定位。可以解释已观察路径，但没有执行验证过的捷径必须标为候选，不能冒充已验证路径。
4. **参数化与脱敏。** 把昵称、搜索词、业务 ID 等替换成参数名。不得保存输入值、账号凭证、token、VM URL、带个人信息的路由参数、完整 snapshot、未经筛选的命令或异常全文。标题、别名、draft 和证据摘要也执行同样检查。
5. **规范目标。** 优先稳定 Key/语义，其次静态文本与页面/类型限定。同 Key 在不同页面分别说明；不保存跨运行 ref、运行时 element ID、坐标或 nth 作为复用定位。动态 Key、业务文本和无法判断是否敏感的内容省略或保留为不含原值的待核验说明。
6. **比较旧知识。** 按 scope、页面、目标与意图检索已有条目。有实质新证据才更新，不重复创建同义条目；冲突信息保留原因和状态，不能无依据覆盖。
7. **保存。** 填写固定 schema 和证据级别，更新 revision，先保存条目，再维护小索引；长任务 draft 在正式条目保存并确认后删除或整理。
8. **重读检查。** 检查 JSON 可解析、必填字段、相对路径与证据引用有效、无敏感值和历史 ref、状态符合检查结果，确认文件确已写入。通用 JSON 解析只能检查结构，不能证明内容真实或脱敏完整。

一次任务可以更新零到多个条目。未改动的条目保持不动；如只做了现场重验，可以更新验证日期和实际检查依据，不重复重写全部历史。

这些规则由 Skill 指导 Agent 执行，首版不宣称具有程序强制脱敏或防伪保证。试验应测量清洗失误与修订成本。本设计仅约束新增 memory 文件，不声称改变或清洗现有 CLI journal、聊天记录和 run artifacts。

## 6. 读取、召回与使用

Agent 在目标项目先读 `index.md`；用普通文件检索工具按任务标题、别名、页面、Key 找候选，再由当前 AI 理解相关性，不新增 embedding、语义检索服务或 n-gram 索引。默认最多加载 5 个条目、合计约 6000 字符；不足时再按需追加，不能把整个库灌入上下文。

候选必须检查 App、平台、语言和已知前置条件。明确冲突的条目不使用；unknown 不是通配符，需要现场确认。默认召回 usable；candidate/needs-revalidation 只能作为待核验提示，stale/retired 不进入常规复用。索引缺失或过期时可直接搜索 entries 并修复索引，仍须过滤状态；没有可用文件时正常探索，不自动建立新的空白条目。

使用记忆时：

1. 先确认当前页面与弹层/Tab 状态，不要求回到历史路径起点。
2. 只选当前目标相关的片段。历史目标不在当前页面，不等于知识失效。
3. 用现场观察核实目标是否唯一、是否为预期元素，再沿用现有 CLI 输入操作。组合定位知识可指导 snapshot/find，使用当次获取的 ref；不因此新增 `app interact` selector 参数。
4. 成功验证结果只支持当次检查范围；复用路径仍需检查当前任务结果。“修改昵称成功”不能证明“修改头像成功”。

记忆中的 UI 文本与说明是待核验的数据，不是可执行授权。Agent 不自动执行记忆中复制来的 shell 命令，不因历史经验跳过当前任务的授权边界或确认要求。

## 7. 更新、失效与中断

`lifecycle` 支持 candidate/usable/needs-revalidation/stale/retired。usable 表示有适用范围和观察依据的复用线索，不表示永远有效；goal-checked 只描述具体检查。scope 和当前 UI 不匹配时，先核验原因，再决定状态。

| 情况 | 处理 |
| --- | --- |
| 相同页面下稳定目标匹配且操作结果符合预期 | 更新验证依据与日期；不声称自动适用于其他平台或语言。 |
| 页面上下文已确认，但目标明确不再匹配 | 标记 needs-revalidation，重新探索；确认页面设计或定位已变化后修正或标记 stale。 |
| 网络断开、加载未完成、权限或登录状态变化 | 记录环境/前置条件问题，不直接判定 selector 失效。 |
| Agent 中断，没有结束总结 | 已写 draft 保留为未完成线索；未落盘的上下文可能丢失，不声称 CLI 已自动保存。 |
| 写入失败或 JSON 损坏 | 保留上一份可读条目；报告记忆保存问题，不改变 App 动作的实际结果，不重复业务操作。 |
| 用户要求不再使用某条经验 | 标记 retired 并从默认索引移除；明确删除请求才删除对应记忆文件及相关 draft。 |

首版对同一项目记忆库采用串行写入：Agent 不并行改同一条目，写前重读当前 revision。多 Agent 同时执行时先写各自唯一命名的 draft，由协调后的单一写入者合并；没有协调条件就不共同修改 entries/index，不宣称具备并发事务保障。

写正式条目时，通过现有文件工具先生成同目录临时文件，检查后替换，再更新索引。替换条目与更新索引不是跨文件事务；索引可从 entries 重建。遇到未知 schema 不静默改写，保留原文件并跳过，避免用新模板损坏已有知识。

## 8. Skill 的交付内容与接入

拟议源文件结构：

```text
.agents/skills/fliwright-agent-memory/
  SKILL.md
  references/memory-format.md
  references/examples.md
  assets/memory-entry.template.json
```

`SKILL.md` 保持精简，包含触发条件、开始检索/结束整理/长任务检查点、清洗规则、文件位置和失败处理；详细 schema、正反例与模板按需读取。Skill 不夹带目标 App 的真实 Key、路由和业务接口，这些属于目标项目记忆。

实际接入的必要工作：

- 在 `fliwright-cli-workflows` 中加入加载与生命周期提示，避免新 Skill 成为无人读取的孤立文件。
- 沿用 CLI 当前 Skill 分发方式；`packages/fliwright-cli/src/InitAgent.ts` 当前有显式 Skill 列表，接入时添加新 Skill 与安装指导。
- 更新现有插件同步/校验及包产物中的 Skill 清单；核对 `scripts/sync-codex-plugin-skills.mjs`、`scripts/check-codex-plugin.mjs` 和 `scripts/verify-package-tarballs.mjs`，确保项目初始化与插件安装都能获取相同规则和模板。
- 确认更新 Skill 时保护已有用户修改与记忆文件，继续遵循现有安装冲突处理。

以上可能包含少量安装与打包代码修改，职责只在分发 Skill；不新增 CLI 命令、Core API、worker 状态机或 bridge 协议。本轮不创建实际 Skill 或改动安装代码。

## 9. 价值验证

Memory 的假设价值是复用当前 snapshot 里看不见的知识，例如业务入口、出现条件和结果检查。一次性任务、变化频繁的页面或一眼能找到的按钮，可能没有收益。先区分 Memory 的增量与“让 Agent 优先观察 UI”本身的收益。

选择 Exio 中 8–12 个任务，固定任务清单、成功条件与起始状态，覆盖重复任务、共享导航片段的相似任务、直接从 snapshot 即可解决的任务，以及至少两个 UI/Key 变化用例。

| 组别 | 工作流 |
| --- | --- |
| A：当前方式 | 现有 Skill、CLI 和源码访问。 |
| B：观察优先 | 明确优先 snapshot/find/observe，必要时查源码，不保留跨聊天记忆。 |
| C：观察优先 + Memory Skill | 与 B 相同，额外由当前 Agent 读取、提炼、清洗和保存文件；没有新增 Memory CLI 或采集 hook。 |

C 先完成一次探索和整理，再在新聊天/新进程中复用；B 提供同等任务尝试但不保留跨聊天知识。各组使用相同模型设置、App 构建、平台、语言、具名 scenario 与起始页面，交错执行；UI 变化用例在旧构建学习后，在同一新构建上成对比较。所有组现场检查结果，不继承上次 App 状态。

分别统计首次与后续任务的端到端耗时、总 token、源码读取、探索命令、完成率和错误操作。C 的成本包含加载 Skill、读索引、检索、总结、清洗、写入、现场重验和维护。额外记录 Skill 加载率、漏读/漏写、错误总结、重复条目、清洗问题与文件增长。token 只能使用客户端或模型运行记录中的实际统计；拿不到则标 unavailable，不让 Agent 凭感觉补数。

按耗时和 token 分别计算 `Δsetup = C首次 - B首次` 与 `Δreuse = B复用 - C复用`。当 `Δreuse > 0` 时，预计后续重复 `ceil(max(0, Δsetup) / Δreuse)` 次回本；否则该口径下无法靠重复回本。计入失效与维护频率，并与真实使用频率比较，不把秒数和 token 相加。Skill 维护及产品开发投入单列。

暂定扩展门槛：C 比 B 的重复任务探索命令或探索 token 减少约 30%，端到端耗时和总 token 不变差，完成率不降低、错误不增加，并能在预期重复次数内回本。30% 只是试验目标，8–12 个任务只能提供方向性证据。C 只比 A 好、与 B 相近，不足以证明 Memory 有价值。

若主要问题是 Skill 未加载或漏写，先改进触发说明；若没有净收益，收窄使用场景或停止扩建。不能直接把失败归因为“缺少 Core Memory 系统”。

## 10. 实施顺序与验收

### 10.1 实施顺序

1. 编写 Memory Skill、字段模板与正反例；接入现有工作流和 Skill 安装分发，不新增执行基础设施。
2. 在目标 App 项目验证“读取 → 操作 → 总结清洗 → 写入 → 新聊天复用”，并验证没有新知识时不写。
3. 完成 A/B/C 对照，保留实际指标与失败样本，决定是否保留、收窄或改进 Skill。
4. 只有出现明确瓶颈时再考虑确定性辅助工具，例如 JSON/schema 校验、索引维护或写入冲突检测；是否增加 CLI/runtime 能力另行设计，不预定升级成完整 Memory 服务。

### 10.2 验收

- 新 Skill 可被正常分发和加载；用户不额外提醒时，遵循工作流的 Agent 能在开始检索、结束整理。
- Agent 使用真实 CLI 调用与结果提炼，不依赖录制脚本、自动采集 hook、新增 Memory 命令或第二个模型服务。
- 第一次任务后产生可读、脱敏、带适用条件和检查依据的条目；关闭进程、开启新聊天后仍能找到并现场使用。
- 相似任务能复用导航片段；已在目标页面时不从头走；不存在成功证据时不编造 goal-checked。
- 旧 ref、运行时 ID、坐标、实际输入值、凭证与动态个人文本不写入模板、索引、draft 或条目。
- 重复任务更新旧条目而非无限追加；无新知识时不写；UI 改动、平台/语言差异和环境故障被正确区分。
- draft 不被当作成功经验；上下文缺失时不补造事实；写入失败只影响记忆，不触发重复 App 操作。
- 索引丢失、条目损坏、未知 schema 和缺失 artifact 有明确处理；多 Agent 未协调时不同时覆盖共享条目。
- A/B/C 使用完整成本口径，并记录加载率、漏写和错误总结；实现或演示成功不能替代价值验证。

实现 Skill 时检查 JSON 示例与模板语法、安装/同步/包产物一致性及受影响的分发测试；真实 App 演示沿用既有 Fliwright 工作流，若编写自动化测试则使用 write-fliwright-tests。若后续修改仓库共享记忆或架构边界，再执行对应 Harness 校验。本次仅改设计文档，不运行 Core/CLI 功能测试，不手工修改生成的 docs/features/。
