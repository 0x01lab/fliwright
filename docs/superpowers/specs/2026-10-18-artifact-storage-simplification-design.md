# 测试产物保存与清理需求整理

日期：2026-10-18。状态：需求整理与设计提案；用户已确认在 `fliwright.config.ts` 中配置保存位置，默认使用项目 `.fliwright` 目录。路径配置与保存归属已实现；清理命令和迁移工具仍为后续提案。未搬迁或删除既有数据。

## 1. 推荐结论

以一次运行作为证据保存、查看、导出和删除的基本单位。默认运行历史为 `<project>/.fliwright/runs`，缓存为 `<project>/.fliwright/cache`，在项目 `fliwright.config.ts` 中可配置。测试、脚本以及 TDD 触发的测试使用同一个 `runsRoot`；一次运行中的截图、Widget 快照、日志、AI 调用和 Trace 都归属于该 run/attempt。

跨运行复用的自愈数据归入 `cache/healing`。独立检查命令的默认临时输出归入 `cache/inspect`，显式 `--output` 则保存到用户指定位置。测试源文件、Mock、Flow 和待编辑的录制草稿按各自用途保存，不参与运行历史清理。

本次先统一归属和生命周期，保留现有 attempt 内部格式。`artifacts`、`snapshots`、`trace` 可以作为一次运行内部的分类；它们不再各自拥有顶层历史和独立保留策略。

已实现范围：项目内默认目录、`runsRoot`/`cacheRoot` 配置与绝对路径传递、CLI/直接 Vitest/IDE/TDD 的运行根接通、attempt 内 AI 记录、`cache/healing` 和独立截图的 `cache/inspect`、init 忽略规则。显式清理、自动清理保护、历史转换与盘点工具尚未实现；以下“当前实现”盘点记录的是改动前状态。

## 2. 当前实现与问题

| 位置 | 当前内容与生产者 | 问题 / 处理方向 |
| --- | --- | --- |
| `~/.fliwright/projects/<project-key>/runs` | 当前 Core 默认路径；CLI、Vitest 新版运行清单、结果及 attempt 证据 | 新默认改为项目内；已有内容显式迁移，用户仍可配置到此处 |
| `<project>/.fliwright/runs` | 历史运行；也可以是显式配置的合法 `runsRoot` | 作为新默认位置；其中既有文件仍须按布局识别，不能覆盖旧内容 |
| `<project>/.fliwright/artifacts` | CLI 独立截图、reload/debug 截图的默认输出；也可能有人工作业资料 | 取消运行时的此类默认散写；人工资料单独盘点 |
| `<project>/.fliwright/traces` | 旧式独立 Trace 历史 | 新版 attempt 已有 Trace 投影；停止默认生产和自动回退读取 |
| `<project>/.fliwright/snapshots` | `SnapshotStore` 保存成功选择器对应的 Widget 特征，供自愈读取 | 改名并迁往 `cache/healing`；不是视觉断言基准，也不是某次失败的截图 |
| `<attempt>/artifacts/snapshots` | 当前运行的 Widget 状态证据 | 保留，随所属 run 一起清理 |
| `<project>/.fliwright/ai` | AI 请求、提示词、响应、调用元数据 | 运行内调用移入对应 attempt，避免导出运行时遗漏 |
| `<project>/.fliwright/tdd/runs` | PersistentTestExecutor 的初次执行和 rerun 子目录 | TDD 不另建测试结果仓库；运行进入统一 runsRoot，循环记录只引用 runId |
| `<project>/.fliwright/recordings` | 录制原始事件、截图、生成和回放相关信息 | 属于录制工作资料；不能按普通历史 run 直接删除 |

源码还保留旧布局相关实现，例如 TraceCollector 的 legacy 布局、VS Code 的历史目录回退和旧索引清理。新版 Vitest 的 Trace 已由 `projectRunTrace` 生成，不能根据这些旧接口仍存在就认定当前运行仍在写顶层 traces。

### exio 实际目录盘点

只统计文件数量和大小，没有读取截图、提示词或业务快照内容。以下为本次检查时的近似值，运行中的目录可能继续变化。

| 位置 | 文件数 | 大小 |
| --- | ---: | ---: |
| 项目内 `artifacts` | 6 | 1.61 MB |
| 项目内 `runs` | 26 | 0.30 MB |
| 项目内 `snapshots` | 37 | 0.02 MB |
| 项目内 `traces` | 3 | 0.002 MB |
| 用户目录该项目的 `runs` | 179 | 4.17 MB |

当前主要问题是入口分散、职责不清，盘点结果尚不足以证明存在磁盘容量问题。项目 `artifacts` 中有 Issue 验证说明和截图，不能一概视为可丢弃临时文件。

## 3. 保存位置与项目配置（默认位置已确认）

| 选择 | 优点 | 代价 |
| --- | --- | --- |
| 用户目录按项目集中保存 | 沿用当前默认；减少仓库内生成内容；checkout 删除后历史仍在；便于统一统计 | 路径不直观；需要 CLI/IDE 提供打开入口；项目换路径后历史不会自动合并 |
| 项目 `.fliwright` 内保存 | 项目自包含；查看直观；CI 产物路径方便；删除项目时同时删除历史 | 每个 worktree 各存一份；必须忽略生成内容；删除 checkout 会删除证据 |

采用项目内默认，优先让项目自包含，便于查看和 CI 收集。用户目录集中保存作为可配置选择，不再是默认，也不再自动回退读取。不同 checkout/worktree 默认各自保存历史；删除项目目录会同时删除其中未导出的产物。

复用已有的 `runsRoot`，为缓存补充可选 `cacheRoot`，不为 screenshots、snapshots、traces、AI 分别增加路径配置。已实现的配置示例：

```ts
// fliwright.config.ts
import { defineConfig } from '@fliwright/cli';

export default defineConfig({
  runsRoot: '.fliwright/runs',
  cacheRoot: '.fliwright/cache',
});
```

两项均可省略，省略时即使用上述默认值；可配置项目相对路径或绝对路径。需要集中保存时，把对应字段设置为项目专用的外部绝对路径，避免多个项目共用同一个 runsRoot。`~` 不作为特殊路径语法；外部位置使用绝对路径。

运行历史的优先级明确为：本次调用显式参数（例如 `--runs-root`）> `FLIWRIGHT_RUNS_ROOT` 环境变量 > `fliwright.config.ts` 的 `runsRoot` > 项目默认。缓存使用本次调用的显式选项（如有）> 项目配置的 `cacheRoot` > 项目默认；首期不新增缓存专用 CLI flag 或环境变量。

相对配置路径统一相对于 `fliwright.config.ts` 所在项目根解析；没有配置文件时使用入口已确定的项目根，不能由各 sink 自行使用进程 cwd。传给子进程前转为绝对路径。默认值在所有配置层合并后补齐，避免提前填充默认值遮蔽用户设置。

CLI、直接 Vitest、TDD、VS Code 的生产、查询、导出和清理必须得到相同路径。直接 Vitest 通过既有 preset 接收项目配置，IDE 与 TDD 使用同一配置解析结果。显式 `runsRoot` 只重定向运行历史；`cacheRoot` 独立配置，不根据 runsRoot 的父目录猜测缓存位置。清理输出必须展示实际位置。

生成的 runs/cache 内容纳入 `.gitignore`；自定义位置位于项目内时提供忽略规则提示。不能忽略整个 `.fliwright`，其中的测试、脚本、Mock、Flow 等编写内容仍可提交。录制草稿继续使用已有 `paths.recordings`，不受 runsRoot/cacheRoot 重定向影响。

## 4. 目标结构与归属

```text
<project>/.fliwright/             # 默认布局；runsRoot/cacheRoot 可分别重定向
  runs/
    <runId>/
      run.json
      report.json                 # CLI 汇总；直接 Vitest 的可用文件以 manifest 为准
      tests/<testId>/attempts/<attemptId>/
        result.json
        events.jsonl
        timeline.json
        trace/trace.json
        logs/...
        failures.json
        artifacts/
          screenshots/...
          snapshots/...
          diagnostics/...
          ai/<invocationId>/...
  cache/
    healing/...
    inspect/<captureId>/...
```

此树表示归属，不表示每次运行都会生成所有文件。继续遵循 `recording.mode = standard | full | off`；本次不增加另一套 Trace/截图开关。`off` 仍保留当前运行结果与恢复所需的最小数据。

| 数据 | 保存规则 | 清理规则 |
| --- | --- | --- |
| 运行证据 | 只能写入所属 run/attempt；运行内 AI 调用使用相同上下文 | 整个 run 删除，覆盖所有 retry/attempt |
| Trace | 同一运行事实的展示投影，引用已有证据 | 随 run 删除，不单独采集、另存截图或设保留期 |
| 自愈缓存 | 跨运行复用；迁移时不改变匹配与自愈语义 | 单独显式重置；清理后历史报告仍能看，但自愈建议或结果可能变化 |
| 独立 screenshot/reload/debug 输出 | 无 `--output` 时写唯一 captureId 的 inspect 缓存并返回实际路径；有 output 时遵循用户选择 | 默认输出按缓存清理；显式输出不纳入托管清理 |
| 独立 AI 诊断输出 | 有 run/attempt 上下文时归属该运行；运行结束后的再诊断默认进 inspect 缓存，避免改写原证据 | 与实际拥有者一同清理；显式导出由用户管理 |
| 录制草稿 | 保留项目 `paths.recordings`；生成测试/脚本/Flow 仍使用既有 paths | 必须走录制资料的显式删除；回放验证产生的 run 仍进入 runs |
| TDD 控制状态 | 循环状态保存 runId/attempt 引用，不复制测试证据 | 控制状态和测试历史分别管理；被清理的 run 显示已过期 |
| CI/团队发布副本 | 通过现有 portable export 输出到指定目录 | 发布端拥有自己的保留策略，不依赖本地目录长期存在 |

运行内 AI 目录不再允许绕过所属 attempt 保存证据；外部指定路径的需求通过显式导出解决。实施时同步调整旧 AI 路径配置，不能继续双写。独立 SDK 调用允许明确传入输出位置；没有运行上下文时不伪造通过的测试结果。

先保留 `result.json`、`timeline.json`、`events.jsonl`、`trace.json`、`report.json`：它们分别承担结果、步骤、恢复和展示等用途，不能仅因内容有交叉就删除。后续若要减少落盘文件，需另行验证恢复和查看器的依赖。

## 5. 精简后的功能需求

### 必须完成

1. **统一寻址**：`fliwright.config.ts` 配置 `runsRoot` 和可选 `cacheRoot`，默认项目 `.fliwright/runs` 与 `.fliwright/cache`；所有入口共用路径解析；日常命令结束时输出 runId 和实际 runDir；查看器提供打开保存目录。
2. **统一归属**：运行内 AI、失败截图、日志和 TDD 执行进入所属 run；证据引用不依赖 runDir 外的文件；失败和重试证据不能被后续尝试覆盖。
3. **完整读取与导出**：查询优先使用 manifest 的 testId/attemptId 和文件引用，不按标题猜路径。导出后移走原目录仍可查看；缺失证据标 partial，保持原测试结论。
4. **统一清理**：新增 `artifacts clean`，支持 `--run-id` 或 `--older-than`，提供 `--dry-run`；按 run 原子隔离后删除，清理残留可重试。输出候选、跳过原因、释放字节数与实际路径。
5. **单独重置缓存**：独立缓存清理入口按 `inspect` / `healing` 选择；普通运行清理不触碰自愈缓存、录制、测试、Mock、Flow、运行配置和租约。
6. **清理保护**：运行中、导出中或有有效占用的 run 跳过；仅看到 `running` 字样或旧时间戳不足以判定进程死亡。先由恢复流程判定遗留运行，再清理。活动读取与删除必须协调；新读取面对已删除 run 返回明确状态。
7. **索引可恢复**：Tests 面板最新结果索引不是历史保留策略；清理后失效引用可移除或显示已过期，不残留可点击但无法说明原因的项目。
8. **旧数据显式处理**：提供盘点/迁移的可执行流程；不在启动、查看或新运行时默默搬迁和删除。

`artifacts clean` 及缓存清理入口是拟新增功能，不是当前已存在的命令。

### 本次精简掉的职责

- 顶层 traces 作为独立历史仓库，以及单独的 Trace 保留策略。
- TDD 自建测试结果根目录。
- AI 在已有运行上下文中另建项目级证据历史。
- 顶层 snapshots 同时指代自愈数据和运行快照的命名歧义。
- 最新状态索引更新就清理完整历史运行的旧策略。
- 自动扫描多处历史目录并猜测“最近一次运行”的回退规则。

首期不增加全局管理平台、内容寻址存储、跨 run 去重、跨 worktree 历史合并，也不修改团队报告平台的部署设计。

## 6. 保留策略与迁移

首期先交付显式清理和 dry-run，不自动删除历史。建议本地清理使用“结束超过 7 天”为初始候选规则，失败与成功同样可保留；需要长期保存的 run 先导出。这个天数是提案，不是现有承诺。团队平台的 30 天 RunBundle 保留决策适用于发布端，不能直接当作本地现有行为。

自动清理、固定保留某些 run、容量阈值作为后续增强；先避免同时引入按天、按数量、按容量等多套规则。

迁移流程：

1. 解析当前项目有效配置，列出新旧目录、布局版本、文件数、大小、引用和建议动作；包含原用户目录默认位置与项目内旧布局，未知文件只报告。切换默认值不触发自动搬迁，也不向用户目录继续双写。
2. 合法 canonical run 整包校验、复制到 staging、重写必要引用，再原子发布；runId 冲突且内容不一致时停止，不覆盖。
3. 旧式 Timeline/Trace 无法直接冒充 canonical manifest。首期显式归档原目录；如需在新查看器中读取，再单独实现转换并标明缺失数据。
4. 自愈 snapshots 可按独立缓存迁移，保留特征和时间字段；没有用户选择时保持原文件。
5. 人工 Issue 验证文件、debug 图、Flow review 包和录制草稿分别确认去向；不能用文件夹名推断删除资格。
6. 校验目标可读取、可导出后报告旧目录可释放量；删除旧副本是单独的显式操作。

新生产者只写目标结构；不新增旧目录兼容或双写路径。已有旧目录回退在切换时删除，历史资料通过显式归档/迁移保留。

## 7. 实施边界与验收

| 所属包 | 改动职责 |
| --- | --- |
| Core | 共享配置类型/校验/合并、项目内默认值、统一路径解析、运行文件归属、缓存路径、引用与清理所需的有效占用判断 |
| Vitest | attempt 上下文传给 AI/日志/证据写入；保持结果和恢复机制 |
| CLI | 查询、打开路径输出、清理 dry-run、独立检查输出、迁移盘点及导出完整性 |
| TDD | 复用统一 runsRoot，记录 cycle 与 run 的关联 |
| VS Code | 使用有效配置路径；移除旧回退；清理后更新索引与历史视图 |

建议分两步实施：先统一路径及生产者并补齐导出，然后增加清理/缓存重置/迁移盘点并移除旧读取。每步完成相关测试后再切换默认行为。

| 验收场景 | 可观察结果 |
| --- | --- |
| 不提供保存位置配置 | CLI、直接 Vitest、IDE、TDD 均使用项目 `.fliwright/runs` 与 `.fliwright/cache`，不创建用户目录产物 |
| CLI、直接 Vitest、IDE、TDD 使用相同项目配置 | 实际 runsRoot/cacheRoot 一致；不新增顶层 traces/ai/tdd-runs 历史 |
| 配置相对路径、绝对路径，或只修改 runsRoot | 运行路径按配置生效；缓存独立解析；从子目录启动也不改变归属 |
| 显式调用路径、环境变量、项目配置及默认值同时存在 | 按约定优先级解析；生产和读取找到相同 run |
| 重试、重复同名测试、多 worker、TDD rerun | 身份隔离；所有尝试证据保留，没有跨尝试覆盖 |
| 运行内 AI、失败截图、Widget 树、日志 | 全部可经所属 manifest/attempt 引用找到；无外部证据依赖 |
| 导出后原目录不可用 | 报告、Timeline、Trace、截图、日志和 AI 文件仍可查看 |
| 清理一个失败 run | 只删除该 run 全部尝试；其他 run、自愈数据和录制不受影响 |
| 清理时有运行、导出、读取或 worker 中断 | 活动数据受保护；遗留数据先恢复；无测试结论被清理流程改写 |
| 清理 healing 缓存 | 运行历史可查看；自愈数据重新学习，不承诺匹配行为完全不变 |
| 旧目录及未知人工文件 | 盘点可见；不自动删除，不静默转换为完整运行 |

实现产生稳定源码改动后，按仓库要求运行受影响包的 build/test/lint，并通过 `/document-features` 重新生成对应实现文档。本文仅整理需求，不运行与文档无关的测试。

## 8. 核对依据

- [现有运行目录解析](../../../packages/fliwright-core/src/runArtifacts.ts)
- [运行与 attempt 文件写入](../../../packages/fliwright-core/src/RunArtifactStore.ts)
- [Timeline 证据分类](../../../packages/fliwright-core/src/timeline/TimelineArtifactStore.ts)
- [自愈 SnapshotStore](../../../packages/fliwright-core/src/SnapshotStore.ts) 与 [SelfHealingEngine](../../../packages/fliwright-core/src/SelfHealingEngine.ts)
- [Vitest attempt 与 Trace 投影](../../../packages/fliwright-vitest/src/AttemptContext.ts)
- [AI 默认保存配置](../../../packages/fliwright-core/src/ai/config.ts)
- [TDD 运行根目录](../../../packages/fliwright-tdd/src/executor/PersistentTestExecutor.ts)
- [CLI 独立截图](../../../packages/fliwright-cli/src/commands/app.ts) 与 [调试截图](../../../packages/fliwright-cli/src/commands/app-inspect.ts)
- [Portable export](../../../packages/fliwright-cli/src/commands/artifacts.ts)
- [VS Code 运行索引与历史清理](../../../packages/fliwright-vscode/src/testing/RunArtifactStore.ts)
- [自动化录制与完整记录既有设计](./2026-10-16-automation-recording-completion-design.md)：延续 run/attempt 身份、统一证据、Trace 投影与禁止旧目录双写的方向。
