# Cloud 本地项目实施计划

日期：2026-10-23。状态：待实施；本次只产出设计与计划。

设计依据：[Cloud 本地项目与 Git 项目统一设计](../specs/2026-10-23-cloud-local-projects-design.md)。

## 1. 实施约束

- 保留当前工作区正在进行的 Cloud/Worker 开发，实施前重新核对实际接口与 DB 版本；不重置用户改动。
- 本次不新增框架、依赖包或跨包依赖方向。Protocol 放 schema；Worker 放主机操作；Cloud 放存储/调度/UI。
- wire contract、CLI 行为和调度修改先写可失败的行为回归测试，再实现；届时使用仓库的 fliwright-tdd skill。真实 Fliwright E2E 同时使用 write-fliwright-tests。
- 按下面顺序实施，测试 seam 为对外行为，不为每个内部 helper 增加镜像测试。

## 2. 工作包

### A. Protocol 与版本模型

涉及 `packages/fliwright-cloud-protocol/src/contracts.ts`、`worker-control.ts`、`worker-timeline.ts`、`index.ts`。

交付：

- ProjectSource、SourceRevision、ScanSelector 和来源感知的 ProjectExecutionSnapshot。
- 登记作业、binding inventory、能力声明、版本观察及结构化错误 schema。
- SourceRevision 进入 Catalog/Request/Attempt；trigger source 保持 manual/push 含义。
- 新增 Worker 操作 allowlist 与 protocolVersion/能力校验；同步 Cloud/Worker consumer，不保留长久双协议。
- timeline 增加 workspace.prepare/resolve_local/verify_local，更新 phase-operation 校验。

回归：Git/local 正常输入、交叉字段拒绝、本地不可带 commit/凭据/Webhook、fingerprint 与 payload 限制、错误身份/代次。

### B. Worker 本地 registry、登记与恢复命令

建议新增 `local-workspaces.ts`、`workspace-lock.ts`、`local-workspace-reporting.ts`，修改 `config.ts`、`main.ts`、`host.ts`。

交付：

- 原子 registry、目录身份检查、realpath 去重、越界/重叠根校验。
- allowedRoots 与 projects add/list/remove/recover；帮助文档与配置示例。
- host 和独立 slot 模式共享 registry 与报告逻辑，不按 slot 各维护一份身份。
- 每 30 秒全量上报，重连/registry 变更重报；受控登记作业领取、心跳、取消与结果。
- 本地持久工作区锁；只有确认 owner 和进程已结束后才能释放或恢复。

回归：同目录别名、并发登记、响应丢失重放、路径替换、外部链接、错误 owner 释放、进程退出/重启后的残锁、凭据不泄漏。

### C. 源码准备 module

新增 `project-workspace.ts` 与内部 Git/Local adapter、`local-input-fingerprint.ts`；修改 `catalog-scanner.ts`、`executor.ts`、`processes.ts`、`worker.ts`、`WorkerAgent.ts`。

先把 Git 源码准备收敛到同一 seam，在不改变已有 Git 行为的测试下接入 Local。

交付：

- reserve/prepare/verifyUnchanged/release 的目录所有权约束与异常清理；controller 持锁、子进程准备源码，owned 进程结束后释放 reservation。
- Git checkout、安装、扫描只读与清理归 Git adapter。
- Local 使用 registry 解析目录，默认 install 为空，报告写 runtime，禁止 checkout sanitization 触达原目录。
- local-inputs-v1 流式指纹，稳定排序、生成目录排除、源码输入保留与资源限额。
- scanner 的前后校验；executor 启动前/测试前/结束后的观测；保留实际 verdict 和 sourceConsistency。
- scan/executor 子进程继续受现有取消、超时、日志与 owned process group 管理。

回归：真实临时 Git 仓库、非 Git 目录、dirty/未跟踪文件、.fliwright/tests 和 mocks、pnpm 链接、排除缓存、源码变更、扫描顶层改写、prepare 失败释放、原目录权限/链接/文件不被框架清理。

### D. Cloud 存储、迁移与调度

修改 `CloudStore.ts`，按规模可提取 `LocalWorkspaceStore.ts`，沿用 CloudStore transaction 与 controlChanged 机制。

交付：

- 当前 DB 到下一版的事务迁移；保留历史与引用，报告 bundle 不重写。
- registry 投影、登记作业租约、workspace_leases。
- 本地来源 Worker/代次/能力/freshness 匹配。
- 在一次事务内取得 slot/scan 与 workspace lease；资源忙不占设备，其他项目继续调度。
- 同 binding 的扫描/运行按入队时间协调，租约过期回收、迟到结果拒绝。
- rerun 冻结原 revision；配置改动不改变旧任务；删除/移除活动 binding 的限制。
- 独立展示 unavailable/stale/busy/source-changed，不新增重复任务状态机。

回归：两 Worker 抢任务、跨项目共享 binding、扫描与执行竞争、事务回滚、generation fencing、重启、离线投影、取消/过期、幂等、Git Push/supersede 不回归。

迁移 fixture 覆盖新 DB 与实际当前版本 DB，包含排队任务、原扫描选择、历史 attempts、报告/分享、slot generation 与幂等键。迁移测试要验证完整业务读写结果。

### E. Cloud handler、CLI 与界面

修改 `server.ts`、`project-setup.ts`、`main.ts`、`ReportStore.ts`、`web/Projects.tsx`、`web/app.tsx`、`web/TestBoard.tsx`、`web/WorkerExecutionTimeline.tsx` 与 protocol client。报告版本元数据涉及 CLI export/发布格式时，在 CLI 拥有的导出 module 内补充并更新对应 schema，不由 Cloud 私改已发布文件。

交付：

- 登记作业 team handler 与 Worker handler；HTTP/WS 共用校验。
- 本地创建表单：唯一 Worker 自动选择，已登记目录/路径输入，异步登记进度，依赖与设备授权提示。
- Git/local 字段分支；本地隐藏 Webhook、branch、凭据、安装命令。
- Catalog 以 catalogId 选择，SourceRevision 统一格式化到所有列表与详情。
- 本地请求通过 Catalog 推导版本；不可传任意执行路径。
- sourceConsistency、stale/source-changed/recovery 提示与重新扫描入口；attempt 与新报告记录版本观察，没有 bundle 也保留准备失败信息。
- 现有 Cloud Git CLI submit/wait/cancel 根据新内部模型适配，保留真实 SHA 验证。

回归：admin/member/operator、CSRF、Worker credential 撤销、Web 注册范围、迟到回传、来源表单、单 case/suite 选择与版本展示；WS 与 HTTP 必须给出一致结果。

### F. 验证、文档与交付

按 A–E 每个工作包先运行相关测试文件，完成后统一运行：

```sh
pnpm --filter @fliwright/cloud-protocol test
pnpm --filter @fliwright/cloud-worker test
pnpm --filter @fliwright/cloud test
pnpm build
pnpm test
pnpm lint
```

CLI 若有行为改动，先运行其相关测试文件。无需为纯 TS 改动无差别运行所有 Dart 测试；新增真实 Flutter 集成时运行对应验证。

真实验证：

1. 同机 Cloud/Worker 添加真实 Flutter 项目，扫描、单 case、suite、scenario、取消、报告回放。
2. Cloud 与 Worker 不共享文件系统的进程/主机部署，重复该流程，证明没有 Server fs 捷径。
3. 修改未提交源码、扫描时改源码、执行时改源码、Worker 离线与恢复。
4. 保留 Git 项目测试与 Webhook 扫描/自动队列链路，确认无跨来源回归。

更新 Cloud/Worker/Protocol README、配置示例与部署升级说明；稳定实现完成后使用 `/document-features` 再生成受影响的 feature docs。若涉及 Harness、依赖或共享学习条目，遵守路由并运行 `node scripts/verify-harness.mjs`。不要在本次设计阶段生成“已实现”的 feature 文档。

## 3. 工作量与里程碑

按一名熟悉仓库的开发者，基础链路约 5–8 个工作日；把网页登记、数据库迁移、版本观测、崩溃恢复和真实 Flutter 验收全部做到本设计标准，预留约 8–12 个工作日。指纹在大型项目上的成本、本地依赖结构和现有未提交改动的整合情况会影响估算。

| 里程碑 | 可验收结果 |
| --- | --- |
| M1：A + B + C | CLI 登记本地目录；同一源码准备 seam 通过 Git 与 Local 的扫描/执行准备测试 |
| M2：D + handler | 持久登记与本地调度闭环，错误 Worker 不可领取，共享工作区串行，迁移与恢复通过 |
| M3：E + F | 页面添加到报告回放完整链路，两种部署通过，Git 回归通过，文档更新 |

每个里程碑保留测试证据；M1/M2 是开发检查点，不作为完整用户需求已交付。快照、watch 与跨 Worker 分发另立后续方案。
