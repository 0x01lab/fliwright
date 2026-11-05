# Worker App 启动加速实施计划

日期：2026-10-29。状态：待实施；本次只制定方案。

设计依据：[启动加速设计](../specs/2026-10-29-worker-app-startup-optimization.md)。

## 1. 实施原则

- 保留当前工作区所有已有改动；开始实现前复核 executor、diagnostics、timeline 和本地项目支持的最新接口。
- 第一期只实现 Git 项目、同一完整版本输入、每 slot 独立的 cold/warm。先不改变设备重置，不引入常驻 App。
- 缓存正确性优先于命中率。未知输入走 cold；原始业务/Bridge 错误不可被自动重跑隐藏。
- selector、协议和 CLI 行为变更补行为回归测试。实现时使用仓库 fliwright-tdd；真实 Fliwright 自动化验证同时使用 write-fliwright-tests。文档阶段不编写实现测试。
- 不添加新框架、依赖或跨包依赖方向。

## 2. 工作包与顺序

### A. 可重复基线和准备配方盘点

涉及：`cloud-worker/src/executor.ts`、`local-packages.ts`、现有项目 install 配置；新增一个本地基准脚本，结果不含秘密值。

交付：

1. 固定 Exio commit、Flutter/Dart/Xcode、模拟器及 OS、entry、flutterArgs 和本地包 bundle。
2. 列出所有 install 步骤的输入、输出、repo 外文件、bridge 复制源、环境变量和幂等语义；不改业务配置来制造缓存命中。
3. 用同一绝对路径连续执行正常启动，先验证 SDK 本身能够利用增量缓存，记录 cold/warm 对照。若仍发生大规模编译，使用 Flutter verbose/Xcode timing 进一步定位构建脚本，而不是直接假定固定目录已经解决。
4. 定义基准统计输入：领取、源码、准备、reset、launch、verify、测试、清理、发布和失败原因。长时间运行由工具异步收集，保留阶段进度。

退出条件：固定输入重复实验能稳定区分 cold/warm；输出真实 timing，证明固定路径可带来收益。若该假设不成立，先解决构建脚本导致的增量失效，再进入 B。

### B. ExecutionWorkspace 模块与准备身份

建议新增 `ExecutionWorkspace.ts`、`PreparationIdentity.ts`，修改 `config.ts`、`host.ts`、`worker.ts`、`processes.ts`。

交付：

1. 准备配方和 executionCache 的严格配置 schema，host 派生到各 slot；cache root 从 slot root 推导，不接受 Cloud 提供的任意主机路径。
2. 内容摘要、工具链探测、完整 key、prepared manifest、ready/in_use/dirty 状态和 attempt owner。
3. 小 interface：独占 acquire、取得传给 owned executor 的 descriptor、在 supervisor 确认停止后 complete/失效；描述符只含本地必要信息，不带 Cloud token。
4. 稳定绝对路径、原子 manifest、schema 失效、目录身份检查、取消和恢复。

回归测试：同 key 稳定；参数顺序、entry、define 文件、toolchain、同路径 tarball/脚本/bridge 内容变化导致 miss；不同 slot 不共享可写目录；ready 原子性；未知外部输入走 cold；不泄露秘密；同一路径被替换或越界拒绝。

### C. 接入 executor 并验证 warm 路径

涉及：`executor.ts`、`WorkerAgent.ts`、`worker.ts`、`processes.ts`、`local-packages.ts`；按实际规模把源码恢复留在 ExecutionWorkspace 内部。

交付：

1. 替换 executor 内部 clone/install 编排，统一消费工作区 descriptor。
2. 冷路径校验精确 commit，准备依赖，生成期望源码/覆盖文件清单。
3. 热路径验证源码及依赖，清理非受管理产物，保留编译环境且不改写内容相同的文件。
4. 配方命中跳过安装；miss 时移除该步骤自己管理的旧输出，再调用安装器；不简单允许已有 node_modules 继续安装。
5. 每次重新运行 Flutter 并验证本次 Bridge；本次 runs/bundle/log/证据仍写入 spool。
6. executor 只提出缓存候选；supervisor 确认进程停止后 seal，异常执行标 dirty。
7. cold 回退最多一次，沿用总 deadline；取消和 lease lost 不回退。

回归测试使用真实临时 Git 仓库和可控子进程，验证第二次实际不执行 clone/install、没有重复触碰源码 mtime、创建本次独立结果、源码被测试修改后拒绝复用、安装失败不 ready、断言失败可保留正确构建、编译损坏只回退一次、协议不兼容不回退。原有 executor-launch/executor-timeline/worker/processes 测试继续通过。

### D. 可观测、容量和管理命令

涉及：Protocol 的 `worker-timeline.ts`/`index.ts`，Worker 的 timeline recorder/channel/IPC、`main.ts`，Cloud 的 `WorkerTimelineStore.ts`、`web/WorkerExecutionTimeline.tsx` 及相关 schema。

交付：

1. 严格的缓存决策事件与有限 miss reason；schema、IPC、服务端 allowlist/投影、网页一起更新，不仅修改 UI 文案。
2. 记录缓存检查、命中/失效、冷回退和真实 Flutter 进度。没有可靠信号时只展示 launch 总耗时。
3. LRU、entry/bytes/TTL/minFree 限制；只清理无 owner 的缓存项。
4. inspect/prune/invalidate 本地命令、帮助、配置示例、默认禁用说明。

回归：事件不改变调度状态；无报告启动失败仍可查看缓存决定；损坏/未知事件拒绝；活动项和恢复证据不能 prune；跨项目不能按不受信任路径清理；磁盘不足有明确失败；CLI 帮助与行为一致。

### E. 第一期真实验证与发布

在固定设备上完成以下矩阵，记录每次 attempt 与指标；性能测试使用配对 cold/warm，正确性故障测试不混入性能对照的正常分组，但单独报告失败率：

| 场景 | 预期 |
| --- | --- |
| 首次相同输入 / 连续重复至少 20 次 | 首次 cold，其余正常 warm；满足设计中的预算 |
| 相同构建输入，不同 case/suite/scenario | 复用构建，选择与场景正确，本次报告独立 |
| 修改 dart-define/flavor/entry | miss，不运行旧环境版本 |
| 同路径替换 bundle、脚本或 bridge 文件 | miss，运行新准备结果 |
| 第一阶段仅测试文件变更 / Dart 源码变更 | 新 commit 均 cold，报告与实际版本一致 |
| Podfile.lock、原生依赖、SDK/Xcode 变化 | cold，不能误命中 |
| 主动损坏缓存 / 中断 prepare 或 launch | dirty 或至多一次 cold 回退；无旧进程 |
| lease lost、取消、超时、stop/reset 失败 | 原有中止和 quarantine 语义保持 |
| 两 slot 同时运行、扫描同时发生 | 工作区独立，无文件写入竞争 |
| 先登录或写数据库，再跑另一场景 | 按 Scenario 隔离，不受缓存命中影响 |
| invalidate、LRU、Worker 重启和 recover | 活动项不删除，dirty 不命中，历史报告可读 |

从一个受控 slot 开启，观察至少一个完整工作日；关键错误版本、进程残留或状态污染任一出现即禁用。性能未达标时保留 disabled，按实测进一步定位，不先全量开启。

### F. 第二期：跨提交增量与 binary 原型

前提：第一期达到正确性和性能门槛。

交付顺序：

1. 拆分 environmentKey 与严格 buildKey；在同一绝对路径切换兼容 commit，验证 Git/生成文件清理不破坏增量。
2. 对 iOS simulator 做 binary machine 启动原型；证明没有 Xcode build、Bridge 属于正确版本、VM 地址为本次新实例且可正常停止。
3. 构建输入闭包与只读 artifact manifest；无法证明输入闭包则不启用跨 commit binary 命中。
4. 验证 test-only 变化可以复用，而 Dart/asset/native/define 变化必须重新构建；原型不通过则只交付跨提交正常增量。
5. 对 Android、iOS physical device 分别扩展验收；不要把 simulator 结果泛化为全平台支持。

### G. 可选：保持模拟器启动

与 F 独立评估。新增 reboot/keep-booted 明确策略，只在 app-owned reset/Scenario 覆盖所需状态且已证明异常恢复语义时启用。衡量任务开始到测试和任务完整周转时间，不能只把重启等待移动到 cleanup。

## 3. 验证命令和文档

每个工作包先执行受影响测试文件。集成完成后运行：

```sh
pnpm --filter @fliwright/cloud-worker test
pnpm --filter @fliwright/cloud-protocol test
pnpm --filter @fliwright/cloud test
pnpm build
pnpm test
pnpm lint
```

如触及 TDD 的 daemon 契约或 CLI，补对应包的聚焦测试。纯 TypeScript 改动不无差别执行 Dart 全仓测试；真实 Bridge 或 Flutter 示例变更按其实际范围运行。

只有涉及依赖、框架、module boundary 或 shared memory 才追加 `node scripts/verify-harness.mjs`。稳定实现后使用 `/document-features` 生成受影响文档，同时更新 Worker 配置、部署/恢复说明和 Cloud 缓存状态文案。

真实性能验收需要独占或记录主机负载，不在用户正在使用的 App 上擅自停止进程；使用明确绑定的测试设备与 owned 进程。交付包含测量数据、样本数、输入身份、回退和失败统计，不以 mocked 单元测试代替性能结论。

## 4. 工作量、里程碑与回滚

按一名熟悉仓库的开发者估算，不是工期承诺；主要不确定性是项目准备脚本输入闭包和 Flutter/Xcode 是否能真正复用增量环境。

| 里程碑 | 内容 | 预估 |
| --- | --- | --- |
| M0 | A：固定目录增量可行性、基线、配方盘点 | 0.5–1 工作日 |
| M1 | B + C：同版本 warm、状态与进程生命周期 | 2–3 工作日 |
| M2 | D + E：观测、容量、管理、真实验收 | 1.5–2 工作日，另观察 1 工作日 |
| M3 | F：跨提交增量和 simulator binary | 2–4 工作日，取决于原型 |
| M4 | G：模拟器策略和状态隔离验证 | 0.5–1.5 工作日 |

第一期约 4–6 个开发工作日；M0 证明不可行时应先修正方案。先交付并测量第一期，再决定是否继续 M3/M4。

回滚只需在本地关闭 executionCache；新任务从全新环境启动，已在运行的任务不强制切换策略。新旧 Worker/Cloud 协议消费者同步更新，不设计长期双协议兼容。禁用后的缓存目录保留到安全 prune，不影响历史 spool、报告或源仓库。
