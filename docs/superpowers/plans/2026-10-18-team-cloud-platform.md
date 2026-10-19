# 团队云测平台实施与验收

依据：[设计](../specs/2026-10-18-team-cloud-platform-design.md)。用户后续已授权“请按计划实现”。

## 技术决策

- 一个私有 `@fliwright/cloud` 包，server / worker / CI client 三个启动命令。
- Fastify + React/Vite；Node 26 内置 SQLite，使用版本化 SQL migration，不引入 ORM 或原生驱动。
- SQLite WAL、事务领取、代次租约、独占槽位；状态与测试 verdict、发布、清理分开。
- 浏览器采用受信身份代理：代理负责 GitLab/OIDC 登录，删除客户端身份头并注入身份和代理密钥；服务端维护角色映射。CI、Worker 使用独立令牌。
- 所有设备控制运行在 macOS 用户会话中的 Worker。独占本地锁和执行日志保护崩溃恢复；失联隔离，恢复必须终止原进程组并重置设备。
- 报告通过有摘要的分文件 staging 上传，不可变提交，SQLite 与文件存储对账。分享只读、短期、可撤销，默认排除日志、源码和网络数据。

## 实施切片

1. 持久化 FIFO、幂等、设备独占、取消、租约过期、有限重试的测试与实现。
2. 身份/权限、管理 API、可重放事件、报告上传、分享、保留及对账。
3. Worker：固定提交、注册命令、reset、Flutter 启动、严格能力预检、执行、上传、清理、恢复与本地 spool。
4. React 管理页、执行详情和历史证据；GitLab submit/wait 门禁。
5. launchd/反向代理部署、备份恢复说明；浏览器与真实设备验收。

## 验收记录

2026-10-19：P1/P2 已实现。完成当前 macOS 主机上的专用 iOS 模拟器与浏览器验收；未将当前开发机验收等同于用户 Mac mini 的正式部署验收。

| 要求 | 当前证据 |
| --- | --- |
| 并发不重复领取，重启不丢任务 | `packages/fliwright-cloud/tests/queue.test.ts`、`concurrency.test.ts`：持久目录重开、真实独立 Node 进程争抢同一槽位 |
| 租约失联不释放设备，旧写回被拒绝 | `queue.test.ts`：可控时钟过期、generation fencing、显式恢复；`worker.test.ts`：失联保留本地锁 |
| 取消和清理失败隔离 | `worker.test.ts`、`processes.test.ts`：取消、reset 失败、PID 身份核验、先协作停止再收敛进程组 |
| 发布中断重试、原子可见、不可变和对账 | `reports.test.ts`：同文件重传、不可变提交、提交后索引丢失对账、预留配额不重复计数 |
| 权限、路径、分享过期撤销 | `server.test.ts`：身份与 Origin；`reports.test.ts`：路径穿越、跨尝试引用、符号链接、过期撤销与 tombstone；浏览器已打开的分享会话在撤销后拒绝访问 |
| 网页提交、报告时间线、截图、历史证据 | 浏览器完成固定 SHA 提交、排队取消、结果详情、步骤截图、断言错误、分享兑换干净 URL；报告从独立持久目录读取 |
| 真 Flutter 成功/断言失败/取消/重置 | `form_demo` 的确定性 clean 场景：成功、断言失败、运行中取消三类任务均 clean cleanup；取消结果 interrupted，partial 报告 published |
| 删除 checkout 后仍可查、备份恢复 | 删除四个验收 checkout，三个报告保持可读；停止 server/Worker，运行实际 backup 命令，恢复到独立目录，三个报告内容一致且 SQLite integrity_check=ok；浏览器确认恢复后的截图可显示 |
| GitLab 门禁 | `client.test.ts`：最新执行 completed/passed、clean cleanup、对应 published 报告才成功；提供 submit/wait/cancel 与 CI YAML |
| 部署交付 | cloud README、私有 JSON 示例、server/Worker launchd plist、nginx/OIDC 模板；需填写团队域名、GitLab 身份和专用设备 |

全仓 `pnpm build`、`pnpm lint`、`pnpm test` 已通过（包含 CLI 250 项、core 976 项、TDD 130 项、VS Code 374 项；Vitest 中 3 项为预期失败）。云测容量回归修复后再次运行 cloud build/test/lint，24 项测试全部通过。已重新生成 feature docs 与 Harness capabilities，`node scripts/verify-harness.mjs --base HEAD --working-tree`、`git diff --check`、launchd plist 语法检查及部署示例配置 schema 校验均通过。

验收使用的服务仅监听 loopback，没有安装到 launchd、发布到团队内网或修改现有 GitLab Runner。验收专用模拟器已关闭并删除，用户原有模拟器未更改。

实时视频按 P3 单独验证，未验证前页面不呈现伪视频或承诺播放能力。
