# Skill + CLI + CI：最新代码重新评估

日期：2026-10-18（Asia/Hong_Kong）
源码基线：`45e3f14`；对比上次设计提交 `3e52d90`，本轮开始时工作区干净。
范围：重新 review 当前 CLI/MCP/core/Vitest/TDD/Skill/CI，并修订迁移设计；未实施删除或运行时改造。

## 结论

继续选择移除自有 MCP、统一 Skill + CLI + CI。最新代码使这个方向更容易落地：执行、录制、回放、证据与导出已成为可复用模块。剩余工作主要是 CLI 的机器契约、缺失的领域入口、持续 TDD/diagnostics 托管，以及 Skill 与 CI 的交付。

现在还不能直接删 MCP：源码仍注册 55 个不同工具和一个报告 resource，CLI 外部命令树未完成等价迁移，plugin/Skill 仍依赖 MCP。55 项映射已重新与注册源码逐项比对，无缺失或重复；字段、效果与生命周期仍需在实施时形成验收账本。详见 [更新后的完整设计](../superpowers/specs/2026-10-17-skill-cli-consolidation-design.md)。

移除理由是目标调用方与维护成本。官方产品资料支持 coding agent 使用 CLI + Skills，但不支持“MCP 协议已过时”；已有 [趋势研究](2026-10-17-cli-mcp-trend-research.md) 的这个边界不变。本轮结论来自最新源码，没有重新开展趋势研究。

## 旧评估中必须撤回或调整的判断

| 旧判断 | 最新实现事实 | 对迁移的影响 |
| --- | --- | --- |
| 录制 driver 释放不完整，需要重建 capture 生命周期 | [RecordingCapture.ts](../../packages/fliwright-core/src/RecordingCapture.ts#L38) 已统一 start、等待/取消、stop/flush、有界 dispose；CLI/MCP 共享，连接失败也释放 | 删除旧泄漏判断；CLI 只需接出已有 duration 与机器输出 |
| run 不处理 child exit/signal、缺取消 | [run.ts](../../packages/fliwright-cli/src/commands/run.ts#L214) 已处理 close code/signal、runner errors、AbortSignal/SIGINT、process group 和升级 SIGKILL | 保留已有实现，补 SIGTERM、whole-command deadline 和退出码映射 |
| 报告/证据需要由 session worker 新建 | [RunSession.ts](../../packages/fliwright-core/src/RunSession.ts#L42)、[RunContracts.ts](../../packages/fliwright-core/src/RunContracts.ts#L118) 已有 attempt/run 结果和 manifest；canonical report 总会落盘 | worker 只托管活动对象，不另造结果模型或报告仓库 |
| 工件 export 只是复制目录 | [artifacts.ts](../../packages/fliwright-cli/src/commands/artifacts.ts#L49) 已校验 manifest/引用/journal、处理 portable paths、保护路径/符号链接、原子发布并支持 partial | 新增离线查询 facade，沿用已有导出 |
| script 需要新增执行路径 | [run.ts](../../packages/fliwright-cli/src/commands/run.ts#L172) 显式 file/glob 可覆盖 include；script fixture 已存在 | `script` 是薄的语义入口；默认回归发现继续只跑 tests |
| CLI 需新建跨进程 app 锁 | [EndpointLease.ts](../../packages/fliwright-core/src/EndpointLease.ts#L31) 已提供队列、文件锁、PID 检查、陈旧恢复、取消与进程内重入 | 接入现有 lease，不能在 CLI 再造锁 |
| record 只是生成测试草稿 | [record.ts](../../packages/fliwright-cli/src/commands/record.ts#L79) 已有 script/test、scenario fingerprint、确认断言、readiness 和严格 verify | 迁移必须完整保留这些契约，不能回退到“生成即通过” |
| Commander 默认值覆盖项目 run 配置 | run 参数默认值已去除，shared config/paths 与 recording env 已整合 | 从待办中移除，保留已有配置优先级 |
| 需要重命名 MCP failure-context 环境变量 | CLI/Vitest/TDD 已改用 attempt results 与 evidence 路径 | 不新增旧变量兼容或第二次替换 |
| CI 没有真实 Flutter 验证 | [.github/workflows/ci.yml](../../.github/workflows/ci.yml#L89) 已有 generated Flutter E2E job | 扩展现有 smoke 的失败、取消与上传；consumer CLI managed launch 仍未实现 |

## 当前仍成立的 review 发现

### P1：Mock 查询和清理语义需先修正

- [mockStatusCommand](../../packages/fliwright-cli/src/commands/mock-management.ts#L20) 调用 `loadRules()`；[MockManager.loadRules](../../packages/fliwright-core/src/MockManager.ts#L164) 会将文件中的 active rules 应用到 Flutter。查询可能撤销刚刚切换的规则。catalog 查询与真实运行状态查询必须分开，status 不应应用规则。
- [mockCallsCommand](../../packages/fliwright-cli/src/commands/mock-management.ts#L52) 新建 driver 后直接 `getCalls()`；新 MockManager 默认 `usesFlutterStore=false`，因而读的是本地新 server，而非之前的 Flutter 调用历史。应提供明确的 Flutter 查询路径，不能用有副作用的 loadRules 作为修补。
- [mockClearCommand](../../packages/fliwright-cli/src/commands/mock-management.ts#L43) 清 routes/calls 并设 passthrough；不能替代 MCP 只清历史的 clearCalls。目标明确区分 `mock clear-calls` 与 `mock reset`。

### P1：持续 runtime 仍未迁移

[withAppSession](../../packages/fliwright-cli/src/capabilities/session.ts#L40) 仍逐命令连接并 dispose；[tdd cycle/sync](../../packages/fliwright-cli/src/commands/tdd.ts#L105) 仍每次创建并最终 stop runtime。MCP state 仍托管持续 driver、订阅、TddRuntime、workflow context。

`RunSession` 是单次 test attempt 的行为与取证会话，不能当作持久连接 host；`RunSessionRegistry` 只是进程内 runner/fixture 交接，也不能当跨进程 registry。需要最小 CLI-local host 保存持续 driver/subscription/TDD executor；有限 run/script/record 和离线 artifacts 不依赖这个 host。

### P2：机器输出、参数验证和 CI gate 仍不完整

[runJsonCommand/exitWithError](../../packages/fliwright-cli/src/index.ts#L910) 成功输出 JSON，错误仍是纯文本和统一 exit 1；Commander 错误不走统一 schema。未知 interact operation 仍可能落出 switch 后无动作成功返回，必须在连接前校验。

[doctor 注册](../../packages/fliwright-cli/src/index.ts#L102) 仍无 `--json --strict` 和关键失败 gate，Node 检查仍以 18 为阈值而 package engines 要求 20。doctor 本身已新增 config/preset/protocol/evidence 检查，缺的是可供 CI 消费的契约。

[record 注册](../../packages/fliwright-cli/src/index.ts#L110) 仍无 duration/JSON/deadline；stdout 混有进度和提示。core 的有界 capture 已经具备，应只补 adapter，前台有界录制足以覆盖当前 MCP record。

run 仍缺整条命令 deadline 与 SIGTERM；`--timeout` 只是 per-test timeout。`--output` 始终写 JSON，`--reporter junit` 输出 XML 到 stdout，尚无 `--junit-output`。不要把 `.xml` 扩展名当作格式选择。

### P2：缺失命令与 Skill/CI 同步仍是迁移主体

CLI 仍缺 schema、snapshot/find/source-map/debug/diagnostics/reload、scenario resolve、离线 failures/timeline/diagnose、Flow runtime capture/review-run，以及持续 TDD prepare/focus/repair/reconnect/scenario 和 devassist 等入口。部分能力已在 core/TDD 存在，优先复用，不能以新增命令名称代替字段级迁移。

[plugin manifest](../../plugins/fliwright/.codex-plugin/plugin.json#L26) 仍注册 mcpServers，Skill 仍路由 MCP workflow。[CLI reference](../../.agents/skills/write-fliwright-tests/references/cli.md) 仍有旧命令树、e2e 默认目录、record 默认模式和 JUnit output 错误示例。修改源 Skill 后用现有 plugin sync/check 保持副本一致。

仓库 CI 已有 E2E，但没有失败时 `always()` 工件上传，TypeScript job 未执行现有 plugin check。当前 smoke 的 app 清理也需要 OS signal 与后代进程退出验证，不能仅依赖 JavaScript finally。仓库自身 smoke 与用户项目的 CI 接口应分别验收。

## 对原 session 方案的重要修正

**父进程不能持 endpoint lease 等待普通 Vitest fork。** [Vitest task preparation](../../packages/fliwright-vitest/src/index.ts#L356) 已获取同 endpoint lease，runner 在 lifecycle/evidence/retry 完成后释放。父进程持锁等待 rerun，而子进程等待父锁，会死锁。AsyncLocalStorage 的重入只在进程内生效。

首版采用阶段边界：控制操作持锁完成后释放，再启动 fixture，由 fixture 获取并释放 lease；同一 host 拒绝交错操作，但不承诺跨进程 sync/reset→rerun 整体原子化。如果产品要求整个 cycle 原子化，先在 core 设计显式 lease delegation/owner handoff，覆盖 fork、retry、取消、崩溃和陈旧恢复测试。不能靠 CLI 第二把锁或让 fork 不加锁来掩盖问题。

TddRuntime 目前拥有并 dispose 自己的 driver；fixture provider 同样会 dispose，不能随意注入一个共享 driver。首版保留所有权，以调度而非共享 JavaScript 对象整合交互。persistent executor 修改进程环境，每个 host 最多一个活跃 TDD runtime。

结果层直接复用 `CliRunResult`、`RunManifest`、`RunSessionResult`，CLI envelope 仅增加 command/request/session 关联。不合并 attemptOutcome/testOutcome，不让 evidence failure 改写断言结果，不把普通 status 查询伪装成 run。连接 session 与 attempt RunSession 使用不同身份。

## 修订后的实施顺序

1. **固定能力账本并修正确性。** 55 工具 + resource 的字段/effects/lifecycle 验收，先修 Mock 和 interact 输入验证；将 app 按次能力接入已有 endpoint lease。
2. **交付有限 CLI + Skill + CI。** 统一 schema/JSON/error/exit；record duration/readiness；doctor strict；run SIGTERM/deadline/JUnit 文件；修正 Skill 示例并扩展现有 CI 的失败工件上传。已有 capture/replay/manifest/export 不重建。
3. **补领域命令与离线查询。** script facade、failure/timeline/diagnose、scenario resolve、snapshot/source/debug、Flow 缺口；按结果和效果验收。
4. **托管持续工作流。** 最小 session host、diagnostics、ref 身份、TDD/devassist；解决 driver ownership 与 lease 阶段交接。跨命令 record start/stop 为可选增强，不作为 MCP 删除的必要前提。
5. **全量迁移验收后删除 MCP。** 包、CLI shim、插件配置、发布/依赖/架构登记、MCP workflow 与提示字符串一起移除；保留外部 Figma provider 的 `figmaMcp` 元数据。更新生成文档与 breaking migration notes，不留兼容 server。

不把“CLI 是唯一受维护入口”解释成将 core/TDD 实现搬进 CLI；这是用户访问路径的收敛。架构仍是 CLI 编排，core/Vitest/TDD 执行，Skill 指导，artifacts 保存事实。

## 当前可用命令与提案的边界

下列命令现已可用。文件和 run ID 应来自用户项目及实际输出；使用 JUnit 重定向前创建 reports 目录。

```sh
fliwright run --test .fliwright/scripts/checkout.script.ts --reporter json
fliwright run --test '.fliwright/tests/**/*.test.ts' --reporter json --output reports/run.json
fliwright run --test '.fliwright/tests/**/*.test.ts' --reporter junit --output reports/run.json > reports/junit.xml
fliwright artifacts show RUN_ID --json
fliwright artifacts export RUN_ID --output reports/evidence --allow-partial --json
```

`script`、`schema`、`session`、`run --json`、`--deadline`、`--junit-output`、`--runs-root` 和 `doctor --strict` 是设计目标，不能写成已实现接口。当前 runs root 可通过 config/env 设置，run 内部接口已有 runsRoot。

## 验证记录

先执行 `pnpm -r --filter '@fliwright/cli...' run build`，core/Vitest/TDD/CLI 构建通过。本地旧 dist 曾导致导出缺失；重新构建后消失，不能当作最新源码缺陷。

| 检查 | 结果 |
| --- | --- |
| CLI lint | 通过 |
| core 10 个相关测试文件：lease、RunSession/artifacts/journal/recovery、recording capture/readiness/automation/config | 91/91 通过 |
| TDD 全量 suite | 126/126 通过 |
| Vitest endpoint lease、runner integration、finalization outcomes 专项 | 13/13 通过 |
| CLI 全量 suite | 182 通过，doctor 两项 5s 超时；对应两个文件单 worker、20s timeout 复查 8/8 通过 |
| MCP 全量 suite | 161 通过，真实 Vitest 子进程两项 5s 超时；对应文件单 worker、20s timeout 复查 11/11 通过 |

上述 timeout 出现在并行运行多个包的首轮检查中，单独复查未复现；没有据此定位出产品逻辑缺陷，也不能称默认全量 suite 全绿。应将 SDK/子进程探测的时限与测试确定性纳入实施验收。

未运行真实 Flutter app、Dart analyze/test 或完整 workspace checks；本轮只修改设计文档。单元/进程测试不能证明实际设备上的操作、录制与 TDD 已完成迁移。
