# Fliwright 团队云测

私有团队平台，一个 package，独立 server 和 Worker 进程。SQLite 保存持久化 FIFO、请求、执行尝试、槽位租约、事件、报告索引和分享；证据放本地磁盘。GitLab 和网页向同一个队列提交，GitLab Runner 不再直接占用平台设备。

## 安装与启动

需要 **Node 26+、pnpm 11.5.3**。Mac Worker 另外需要 Flutter、Xcode、可用 iOS runtime、仓库只读凭据和专用模拟器。服务端可以和 Worker 同机；不要将 SQLite 放在网络盘。

```sh
pnpm install
pnpm build
node packages/fliwright-cloud/dist/main.js server /PRIVATE/PATH/server.json
node packages/fliwright-cloud/dist/main.js worker /PRIVATE/PATH/worker-ios.json
```

复制 `deploy/*.example.json` 到仓库外的私有配置目录，替换所有占位符，配置/日志/spool 仅让运行账户读取。server 和 Worker 的 deviceId 必须一致。target 的 suite/scenario 应与应用 `fliwright.config.ts` 中命名组合的 `TestScenario` 对应；认证状态通过应用的 `auth.seedLoggedIn` 准备。Worker 每次新建 checkout；安装命令需要保证 Flutter 和 TypeScript 依赖及所需构建已准备好。

管理员通过应用配置页面/API 注册应用，SQLite 为注册配置的持久来源；JSON targets 只在首次注册时播种，不覆盖网页修改。每次提交保存目标快照，后续配置变化不影响已排队请求。Worker/设备的初始映射由部署配置维护；新增应用后也要更新对应槽位的 targets 并重启服务。

## 登录与凭据

浏览器使用可信反向代理身份。推荐 oauth2-proxy + GitLab OIDC，nginx 示例见 `deploy/nginx.conf.example`。代理必须删除客户端伪造的身份头，注入登录用户名和与服务端一致的 proxySecret；server 仅监听 loopback。`users` 显式映射 member/operator/admin，未登记用户拒绝访问。修改操作核对 publicUrl 的 Origin。

CI 与 Worker 分别使用随机 bearer token，server 配置仅保存其 SHA-256。生成 token 可使用系统密码管理工具；将 token 放入私有环境变量后计算摘要：

```sh
FLIWRIGHT_CLOUD_TOKEN="$FLIWRIGHT_CLOUD_WORKER_TOKEN" node packages/fliwright-cloud/dist/main.js hash-token
```

proxySecret 与 publicationSecret 用 `env:VARIABLE_NAME` 引用；保持 publicationSecret 稳定以便恢复上传。凭据不放 URL。分享令牌位于 URL fragment，页面兑换 HttpOnly 会话后跳转到干净地址；分享路由和静态 assets 需允许经过代理，实际报告仍由服务端分享会话授权。

平台代码不能约束绕过平台的 CI 脚本。**专门创建一个可擦除的模拟器给 Worker**，不要使用开发者日常模拟器。示例 reset 会 shutdown/erase/boot 指定设备，任务前后都执行。现有 Runner 保留普通构建任务，限制并发以留出 Flutter 资源。

## 队列与故障恢复

- 相容槽位按提交顺序领取，SQLite `BEGIN IMMEDIATE` 保证独占。请求幂等键按提交身份区分；相同键但不同内容返回 409。
- Worker 5 秒心跳，租约 30 秒。上传、心跳、完成绑定执行 attempt/generation。心跳过期隔离槽位，**不会自动当作设备空闲**。
- 排队取消立即结束；运行取消停止拥有的进程组，尽量导出 partial 证据，reset 后释放。测试 verdict、证据发布和 cleanup 独立呈现。
- 断言失败不自动重试。只有明确上报 transient 基础设施失败且清理成功时最多一次自动重试；默认 Worker 的未知准备/构建故障归为 permanent。人工重新运行产生新请求。
- 本地 `slot.lock` 和 spool 保存资源归属；崩溃/失联/清理失败保留锁，重启不会擅自复用设备。

先停止 launchd Worker，再执行：

```sh
node packages/fliwright-cloud/dist/main.js recover /PRIVATE/PATH/worker-ios.json
node packages/fliwright-cloud/dist/main.js retry-uploads /PRIVATE/PATH/worker-ios.json
```

recover 检查原 Worker 已退出，核对并终止原进程组，执行配置中的设备 reset，然后申请恢复槽位。原租约尚未到期时服务端拒绝恢复；等待到期后重试。若 PID 身份不明则保留隔离，由运维核查，不猜测杀进程。不要手动删除 slot.lock 绕过核查。

上传保留 publication capability，可在 clean finish 后重传同一不可变报告；已失联执行不能继续写入。retry-uploads 不重新运行测试，不改变原始 verdict。spool 含日志与 checkout，需运维按报告已发布和终态确认后清理；不要在未确认上传时删除。

## 报告回放

报告详情顶部提供按真实经过时间排列的执行时间轴，操作条展示耗时及状态，重叠操作分轨显示。点击时间条或拖动游标可联动步骤、截图和证据详情，支持 1×–8× 缩放。未采集时间的操作仍可从步骤列表查看；没有截图时明确提示。只读分享使用相同回放界面。

## GitLab 接入

参见 `deploy/gitlab-ci.example.yml`。CI 服务账户只能提交、读取/取消自己的任务，不能控制设备或管理应用。submit 返回稳定执行 URL；wait 在 completed + passed + clean + 最新执行报告 published 时成功，失败退出 1，等待超时退出 2。客户端超时/断开不默认取消平台任务。

```sh
node packages/fliwright-cloud/dist/main.js submit /PRIVATE/PATH/client.json request.json unique-request-key
node packages/fliwright-cloud/dist/main.js wait /PRIVATE/PATH/client.json REQUEST_ID
node packages/fliwright-cloud/dist/main.js cancel /PRIVATE/PATH/client.json REQUEST_ID
```

## macOS 常驻部署

`deploy/com.fliwright.cloud.*.plist` 是 launchd User Agent 模板。复制到运行账户的 `~/Library/LaunchAgents/`，替换 Node/Flutter/PATH/配置/日志路径和私有环境变量，权限设 600，再用 `launchctl bootstrap gui/$(id -u) ...` 启动。launchd 不读取 `.zshrc`，必须显式设置 PATH。Worker 要在可使用 Simulator 的登录用户会话中运行；FileVault、重启后登录、Xcode 首次启动授权及休眠策略需要在实际 Mac mini 验证。

同一 Mac mini 可同时运行原 GitLab Runner、server、Worker 和身份代理。首期一个槽位；增加设备时为每个槽位配置独立 Worker root/launchd 实例。共享物理设备必须仅有一个槽位映射。媒体采集后续另部署。

## 保留与备份

默认报告 30 天，分享最多 7 天且不超过报告期限。过期记录保留为 tombstone，旧链接返回 410。正在执行的报告不会被清理；下载先完整读取到内存，清理不会中断已取得的数据。容量不足时拒绝发布，保留测试原结论。上传每文件最多 32 MiB、整包默认 128 MiB；staging 终态一天后可回收。定期对账处理文件提交成功但索引尚未更新的情况。

取得一致备份前暂停提交并**停止 Worker 和 server**，再运行：

```sh
node packages/fliwright-cloud/dist/main.js backup /PRIVATE/PATH/server.json /NEW/PRIVATE/BACKUP/DIRECTORY
```

备份使用 SQLite VACUUM INTO，同时复制报告目录。另备份私有配置/密钥和未确认上传的 Worker spool。恢复到隔离目录，替换 dataRoot，核对用户/凭据/报告分享密钥；先检查历史报告，再对遗留占用执行 recover，最后恢复调度。禁止将未知设备状态直接改为空闲。

## 当前验收边界

自动化覆盖队列、租约、权限、上传、分享和 Worker 故障行为。当前 macOS 主机已用专用 iOS 模拟器验证真实 Flutter 成功、断言失败、运行中取消及设备重置；浏览器验证报告截图、分享与撤销。删除 checkout、停止服务后执行备份并恢复到独立目录，三类历史报告仍可读取。

部署模板仍需绑定团队 GitLab OIDC、域名、证书、仓库和实际 Mac mini 设备。尚未修改现有 Runner 或安装常驻服务。实时视频属于 P3；当前页面明确显示尚未开放，不用截图轮询冒充视频。
