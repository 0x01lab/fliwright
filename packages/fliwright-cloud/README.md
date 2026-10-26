# Fliwright 团队云测

私有团队平台，Server 与 Worker 分包独立部署。`@fliwright/cloud` 运行管理页面、队列和报告服务；设备电脑部署 [`@fliwright/cloud-worker`](../fliwright-cloud-worker/README.md)，通过 WebSocket 控制通道和 HTTP 报告上传连接同一个 Server。双方共享 `@fliwright/cloud-protocol`，本机扫描由 Worker 调用 `@fliwright/devices`。SQLite 保存持久化 FIFO、请求、执行尝试、槽位租约、事件、报告索引和分享；证据放本地磁盘。GitLab 和网页向同一个队列提交，GitLab Runner 不再直接占用平台设备。

## 前端 UI

云测控制台使用 React、Tailwind CSS 4 和本地维护的 shadcn/ui（new-york）组件。
基础组件位于 `src/web/components/ui/`，主题令牌与回放专用布局位于
`src/web/style.css`；Vite 通过 `@tailwindcss/vite` 编译样式。
`components.json` 记录组件配置，新增组件沿用该目录和 `cn()` 工具，
相对导入遵守仓库 ESM 的 `.js` 约定。

表单使用 shadcn Native Select 保留原生选项、表单值和校验；
复选框、时间轴滑块与证据标签页使用 Radix primitives。
明暗主题沿用 `data-theme` 和 `cloud-theme` 本地偏好；状态颜色独立于测试结论。

整体采用单行顶部导航与下方全宽工作区，使用本地维护的 shadcn Navigation Menu
及 Radix Navigation Menu primitive。Logo 返回 `/`；主导航仅保留运行记录、测试队列，
设备管理、Worker 主机、应用配置与测试报告统一收进「配置」菜单，支持键盘和 Escape
关闭。搜索、主题、提交测试与当前用户集成在同一工具栏；窄屏搜索独立换行。
报告详情不受侧栏或最大内容宽度限制，步骤回放沿用响应式布局。

站内路由由 TanStack Router 管理，路由树位于 `src/web/app.tsx`，
`src/web/main.tsx` 负责挂载应用。内部导航使用 `Link`，提交、重跑及分享兑换
使用 `useNavigate`，切换页面时保留布局，不刷新整页。搜索参数由路由校验并
响应浏览器前进/后退；服务端继续为页面深层链接返回入口 HTML。
外部 Pipeline、报告产物下载及页面内锚点保留原生链接语义。

## 本地设备检测

Worker 复用独立公共包 `@fliwright/devices`，启动及 WS 重连后立即扫描；Android 使用 `adb track-devices`，iOS 真机使用 `xcdevice observe --both`，iOS 模拟器监听设备目录中的状态文件变化，事件合并 150ms 后触发扫描并通过 WS 上报。另每 30 秒校准设备清单并续期；任务执行期间继续上报。独立的 `/devices` 设备管理页汇总各 Worker 的 iOS / Android
真机和模拟器，包括未启动模拟器、离线或未授权 Android 设备及 Xcode 已知不可用真机。
工具缺失与检测失败单独提示，服务端 90 秒未收到更新会标记清单已过期。
页面显示 Worker 所在机器的设备。

扫描结果与执行槽位分开，发现设备不会自动允许调度，断开设备也不自动释放租约。
可通过 Worker 私有配置的 `deviceTools: { adb, emulator, xcrun }` 指定工具路径；
默认检测 Android SDK 环境变量、标准 SDK 安装路径和 PATH。
扫描不启动、擦除或解锁设备；ADB 可能启动其正常后台进程。重置仍使用显式配置。

本地终端使用 `fliwright devices list --json`，可用 `--platform ios` 或
`--platform android` 筛选。

## 设备管理与纳管

- `/devices` 提供跨 Worker 列表，可按平台、真机/模拟器、主机、连接和调度状态筛选；筛选保留在 URL。
- `/devices/:id` 显示发现信息、最近联系、槽位状态和调度阻塞原因，operator/admin 可修改别名、标签、纳管状态、调度开关、允许应用和槽位；member 只读。管理写入有 Origin 校验和操作者审计。
- 设备身份包含 Worker、平台、类型和原生 ID；Android AVD 优先以 AVD 名称关联启动前后记录。设备消失后保留管理配置，显示“本次未发现”。Worker ID 应固定对应一台主机，不要让多台主机共用。
- 纳管和保存槽位不会自动部署执行进程。每个槽位仍需独立 Worker root、resetCommands 和本地 Worker 进程；详情页给出 workerId、slotId、当前 deviceId 和部署要求。Android 模拟器原生 ID 变化后需更新本地 Worker 配置。
- 新任务仅分配给已纳管、启用、授权该应用、发现在线且未过期、主机未暂停、槽位空闲并有匹配运行进程的设备。运行进程联系 30 秒后失效；发现结果 90 秒后失效。未启动模拟器需人工在主机启动。
- 暂停单台设备仅阻止新分配，不取消当前租约。占用/隔离状态禁止换绑和更改应用范围，保持已有 fencing/recover 流程。

管理员可以在 `/workers` 页面为新主机生成一次性配对码。配对码有效 10 分钟且只能使用一次；在打包机创建一个新目录并运行：

```sh
fliwright-worker pair https://cloud.example.com /PRIVATE/PATH/cloud-worker
```

CLI 会安全地提示输入配对码，保存 `credentials.json` 与 `worker.json`（目录 `0700`，文件 `0600`），不会打印凭据。然后启动设备发现：

```sh
fliwright-worker discover /PRIVATE/PATH/cloud-worker/worker.json
```

发现设备后在网页登记执行设备和应用，再为槽位配置完整 `run` 文件。撤销配对会使已建立的 Worker WebSocket 连接失效。配对接口只接受 HTTPS；本地开发可使用 loopback HTTP。

已有静态部署也可以使用初始配置登记 `{ "id": "mac-02", "slots": [] }` 和对应 Worker token，然后使用仅检测配置启动：

```json
{ "serverUrl": "https://cloud.example.com", "tokenEnv": "FLIWRIGHT_CLOUD_WORKER_TOKEN" }
```

```sh
node packages/fliwright-cloud-worker/dist/main.js discover /PRIVATE/PATH/discovery.json
```

检测配置可包含 `deviceTools`。发现后在网页纳管、选择允许应用和槽位，再为该槽位部署完整 Worker 配置。
`GET /api/device-events` 是仅团队浏览器可访问的 SSE 通知流；设备列表与详情收到通知后重新读取当前数据，不再每 3 秒轮询。服务端也检测状态过期等时间变化；断线重连后立即刷新，连接每 60 秒重建以重新校验身份。

`GET /api/devices`、`GET /api/devices/:id` 与 `PUT /api/devices/:id` 是设备管理接口；PUT 接受完整管理配置，
字段为 `alias`、`tags`、`managed`、`enabled`、`targets`、`slotId`（可为 null）。Worker claim 必须携带实际 `deviceId`。

## 本地启动

需要 **Node 26+、pnpm 11.5.3**。在仓库根目录执行一次：

```sh
pnpm install
pnpm --filter @fliwright/cloud... build
pnpm cloud:init
```

之后使用统一入口启动和检查，无须进入系统数据目录：

```sh
pnpm cloud:start
# 在另一个终端检查
pnpm cloud:health
```

打开 `http://127.0.0.1:4780`。Server 前台运行，Ctrl+C 或 SIGTERM 会关闭连接与数据库。
本地模式只使用一个端口，网页和 Worker WebSocket 由标准 Server 直接提供。
`cloud:init` 生成 `.fliwright/cloud/server.json`，目录权限 0700、配置权限 0600，
随机生成并保存密钥；重复初始化会报错并保留原配置。此目录已被 Git 忽略。

配置选择顺序：显式文件参数、`FLIWRIGHT_CLOUD_CONFIG`、当前工作目录的
`.fliwright/cloud/server.json`。`dataRoot` 相对配置文件所在目录解析，配置和数据可以
放在仓库之外；程序目录不承担保存运行状态的职责：

```sh
pnpm cloud:init /PRIVATE/PATH/cloud-config
pnpm cloud:start /PRIVATE/PATH/cloud-config/server.json
FLIWRIGHT_CLOUD_CONFIG=/PRIVATE/PATH/cloud-config/server.json pnpm cloud:health
```

初始化的 `localUser` 用于本机管理：仅接受 loopback 连接、配置的 Host 和同源浏览器
请求，写操作还须有匹配 Origin。不能将此模式绑定到 `0.0.0.0` 或公网地址。
团队部署移除 `localUser`，使用下面的 HTTPS 身份代理。

旧 `local-preview/start.mjs` 是临时启动器，现已由标准入口取代。已有数据可继续放在
原位置：在新配置中设置绝对 `dataRoot`，沿用原 `publicationSecret`、Worker token 摘要
和用户配置。若要保持原浏览器地址，将 `port` 和 `publicUrl` 一起改为 4781；不再启动旧代理。
不要对已有报告重新生成 publicationSecret。

## 独立部署

在仓库根目录生成含编译代码、网页资产和生产依赖的独立部署目录：

```sh
pnpm cloud:deploy /NEW/PATH/cloud-server-release
pnpm cloud:deploy-worker /NEW/PATH/cloud-worker-release
```

两条命令分别构建 Server / Worker 的依赖，并通过 `pnpm deploy --legacy --prod`
导出；目标目录必须不存在，避免覆盖正在运行的版本。部署目录可以复制到相同操作系统
和架构、装有 Node 26+ 的机器，无须 checkout 仓库或在目标机器安装 pnpm。

```sh
node /PATH/cloud-server-release/fliwright-cloud init /PRIVATE/PATH/cloud-config
node /PATH/cloud-server-release/fliwright-cloud server /PRIVATE/PATH/cloud-config/server.json
node /PATH/cloud-server-release/fliwright-cloud health /PRIVATE/PATH/cloud-config/server.json
node /PATH/cloud-worker-release/fliwright-worker --help
```

正式环境使用 `deploy/server.example.json` 配置 HTTPS publicUrl、用户和私有环境变量，
不用本地 `localUser`。配置、SQLite、报告、Worker spool 与代码发布目录分开存放，升级时
停止服务、备份数据，切换代码版本后沿用同一配置启动。数据库迁移后回退须恢复匹配备份。
常驻服务、日志及升级操作见 [部署指南](./deploy/README.md)。

## Worker 安装与启动

Mac Worker 另外需要 Flutter、Xcode、可用 iOS runtime、仓库只读凭据和专用模拟器。服务端可以和 Worker 同机；不要将 SQLite 放在网络盘。

```sh
pnpm --filter @fliwright/cloud-worker... build
pnpm cloud:worker pair https://cloud.example.com /PRIVATE/PATH/new-worker
pnpm cloud:worker discover /PRIVATE/PATH/new-worker/worker.json
# 完成设备纳管及槽位配置后启动执行 Worker
pnpm cloud:worker run /PRIVATE/PATH/worker-ios.json
```

复制本包 `deploy/server.example.json`、`deploy/client.example.json` 和 Worker 包 `deploy/worker.example.json` 到仓库外的私有配置目录，替换所有占位符，配置/日志/spool 仅让运行账户读取。server 和 Worker 的 deviceId 必须一致。target 的 suite/scenario 应与应用 `fliwright.config.ts` 中命名组合的 `TestScenario` 对应；认证状态通过应用的 `auth.seedLoggedIn` 准备。Worker 每次新建 checkout；安装命令需要保证 Flutter 和 TypeScript 依赖及所需构建已准备好。

管理员通过应用配置页面/API 注册应用，SQLite 为注册配置的持久来源；JSON targets 只在首次注册时播种，不覆盖网页修改。每次提交保存目标快照，后续配置变化不影响已排队请求。Worker 与初始槽位只在首次注册该 Worker 时播种。后续设备配置以 SQLite 为准，启动文件不会覆盖网页修改或重新创建已解绑槽位；新增应用后在设备详情页授权，无须重启服务。主机移除须暂停 Worker 并撤销其凭据，删除启动配置不会隐式暂停或删除已登记主机。

## 登录与凭据

浏览器使用可信反向代理身份。推荐 oauth2-proxy + GitLab OIDC，nginx 示例见 `deploy/nginx.conf.example`。代理必须删除客户端伪造的身份头，注入登录用户名和与服务端一致的 proxySecret；server 仅监听 loopback。`users` 显式映射 member/operator/admin，未登记用户拒绝访问。修改操作核对 publicUrl 的 Origin。

CI 与 Worker 分别使用随机 bearer token，server 配置仅保存其 SHA-256。生成 token 可使用系统密码管理工具；将 token 放入私有环境变量后计算摘要：

```sh
FLIWRIGHT_CLOUD_TOKEN="$FLIWRIGHT_CLOUD_WORKER_TOKEN" node packages/fliwright-cloud/dist/main.js hash-token
```

proxySecret 与 publicationSecret 用 `env:VARIABLE_NAME` 引用；保持 publicationSecret 稳定以便恢复上传。凭据不放 URL。分享令牌位于 URL fragment，页面兑换 HttpOnly 会话后跳转到干净地址；分享路由和静态 assets 需允许经过代理，实际报告仍由服务端分享会话授权。

平台代码不能约束绕过平台的 CI 脚本。**专门创建一个可擦除的模拟器给 Worker**，不要使用开发者日常模拟器。示例 reset 会 shutdown/erase/boot 指定设备，任务前后都执行。现有 Runner 保留普通构建任务，限制并发以留出 Flutter 资源。

## Worker 公网连接

Cloud 可部署公网 HTTPS 域名，内网打包机的 Worker 主动连接 `/api/worker/connect`（WSS），不需要打包机公网地址或入站端口。Bearer token 在 Upgrade 时校验，仅允许 Worker 身份；控制消息只能调用白名单 Worker 操作。任务和扫描领取由队列变化通知驱动，取消即时推送，执行心跳仍维护 30 秒租约。设备清单也走同一连接；报告文件、发布创建和提交仍使用 HTTPS。旧 Worker HTTP 控制路由已移除，Server 与 Worker 需要一起升级，旧 `pollMs` 配置需删除。

反向代理模板包含 WSS Upgrade、Authorization 转发以及 GitLab Webhook 的独立入口，均清除浏览器身份头，由 Cloud 校验各自凭据。空闲断线指数退避重连；执行中失联仍中止并锁定槽位，不自动重放 RPC 或恢复旧租约。

## 队列与故障恢复

- 相容槽位按提交顺序领取，SQLite `BEGIN IMMEDIATE` 保证独占。请求幂等键按提交身份区分；相同键但不同内容返回 409。
- Worker 5 秒心跳，租约 30 秒。上传、心跳、完成绑定执行 attempt/generation。心跳过期隔离槽位，**不会自动当作设备空闲**。
- 排队取消立即结束；运行取消停止拥有的进程组，尽量导出 partial 证据，reset 后释放。测试 verdict、证据发布和 cleanup 独立呈现。
- 断言失败不自动重试。只有明确上报 transient 基础设施失败且清理成功时最多一次自动重试；默认 Worker 的未知准备/构建故障归为 permanent。人工重新运行产生新请求。
- 本地 `slot.lock` 和 spool 保存资源归属；崩溃/失联/清理失败保留锁，重启不会擅自复用设备。

先停止 launchd Worker，再执行：

```sh
node packages/fliwright-cloud-worker/dist/main.js recover /PRIVATE/PATH/worker-ios.json
node packages/fliwright-cloud-worker/dist/main.js retry-uploads /PRIVATE/PATH/worker-ios.json
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

Server 的 `deploy/com.fliwright.cloud.server.plist` 与 Worker 包的 `deploy/com.fliwright.cloud.worker.plist` 是 launchd User Agent 模板，入口指向独立部署目录中的二进制包装脚本。安装、启停、日志及 Linux systemd 操作见 [部署指南](./deploy/README.md)。launchd 不读取 `.zshrc`，必须显式设置 Node/Flutter/PATH。Worker 要在可使用 Simulator 的登录用户会话中运行；FileVault、重启后登录、Xcode 首次启动授权及休眠策略需要在实际 Mac mini 验证。

同一 Mac mini 可同时运行原 GitLab Runner、server、Worker 和身份代理。首期一个槽位；增加设备时为每个槽位配置独立 Worker root/launchd 实例。共享物理设备必须仅有一个槽位映射。媒体采集后续另部署。

## 保留与备份

默认报告 30 天，分享最多 7 天且不超过报告期限。过期记录保留为 tombstone，旧链接返回 410。正在执行的报告不会被清理；下载先完整读取到内存，清理不会中断已取得的数据。容量不足时拒绝发布，保留测试原结论。上传每文件最多 32 MiB、整包默认 128 MiB；staging 终态一天后可回收。定期对账处理文件提交成功但索引尚未更新的情况。

取得一致备份前暂停提交并**停止 Worker 和 server**，再运行：

```sh
node packages/fliwright-cloud/dist/main.js backup /PRIVATE/PATH/server.json /NEW/PRIVATE/BACKUP/DIRECTORY
```

备份使用 SQLite VACUUM INTO，同时复制报告目录。另备份私有配置/密钥和未确认上传的 Worker spool。恢复到隔离目录，替换 dataRoot，核对用户/凭据/报告分享密钥；先检查历史报告，再对遗留占用执行 recover，最后恢复调度。禁止将未知设备状态直接改为空闲。

## 当前验收边界

## 项目、测试目录与自动运行

管理员在「项目」创建和编辑仓库配置；项目设置是后续唯一的 Cloud 写入配置源。旧 SQLite `targets` 记录在 migration 中转成同 ID Project，历史任务和报告保持原有快照。旧 `/api/admin/targets` 写接口已移除；`/api/targets` 仅提供脱敏只读视图供旧运行表单使用。初始部署 JSON `targets` 只用于引导新数据库迁移，之后可从 server 配置移除。

创建项目只需填写 GitLab 项目主页或 HTTPS / SSH 克隆地址。服务端自动生成项目 ID，名称从 URL 中的仓库名推导；默认配置为 `main` 分支、仓库根目录、`lib/main.dart` 入口、`smoke` 套件和 `clean` 场景。展开可选配置可以调整名称、分支等设置；这些是预填默认值，不会通过 GitLab API 自动读取仓库元数据。

配对后在主机运行一次 `fliwright-worker run worker.json`，然后在网页为设备选择允许的应用并保存：设备自动纳管、启用并生成稳定槽位，本机自动创建独立执行目录和执行器。已有纳管设备缺少槽位时会在同步时补齐，无需手填 slotId、deviceId 或重复部署进程。iOS 模拟器默认重启并保留数据；其他设备的重置命令在主机配置。设备应用范围也自动成为该主机的扫描范围；纯扫描主机可额外配置 `catalogProjects`。Cloud 的 `repositoryHosts` 必须列出允许访问的 Git 主机；Worker 的 `repositoryCredentialHomes` 将 Project 凭据引用映射到本机只读 Git/SSH credential helper。Cloud 只保存引用与 Webhook token 摘要，不接收仓库凭据明文。

项目页扫描默认分支或完整 40 位 SHA，浏览固定 commit/config revision 的 Catalog；管理员检查后显式确认 ready。operator 可请求和取消扫描，member 可浏览目录及提交已扫描版本的 suite/case。case 使用 Catalog 中重复序号校验并映射到 Vitest task ID，不能通过浏览器提供文件路径或正则扩大运行范围。提交需要 Idempotency-Key，Worker 保存项目配置快照。

GitLab 自动运行默认关闭。管理员在项目设置选择默认分支及 suite/scenario 组合并生成一次性 Secret Token；GitLab Webhook 使用 Push events 和显示的 endpoint。重复 delivery 去重；事件 SHA 先扫描，Worker 用只读 Git 凭据核对分支当前 HEAD，再按事件 SHA 固定 Catalog。旧排队自动任务标记 superseded 并关联新任务；已领取任务和手动请求保留。失联扫描租约在 30 秒后过期，单项目最多排队 100 个扫描。扫描进程的模块顶层副作用仍可能执行，因此仅绑定团队授权仓库；部署主机还应使用网络防火墙限制出站 Git 主机。

运行记录包含来源、固定 commit、selection、config/catalog revision 和自动策略 revision。真实 GitLab 凭据、仓库主机 allowlist、出站网络策略以及专用设备上的 push 到报告链路必须在部署环境单独验收。

自动化覆盖队列、租约、权限、上传、分享和 Worker 故障行为。当前 macOS 主机已用专用 iOS 模拟器验证真实 Flutter 成功、断言失败、运行中取消及设备重置；浏览器验证报告截图、分享与撤销。删除 checkout、停止服务后执行备份并恢复到独立目录，三类历史报告仍可读取。

部署模板仍需绑定团队 GitLab OIDC、域名、证书、仓库和实际 Mac mini 设备。尚未修改现有 Runner 或安装常驻服务。实时视频属于 P3；当前页面明确显示尚未开放，不用截图轮询冒充视频。
