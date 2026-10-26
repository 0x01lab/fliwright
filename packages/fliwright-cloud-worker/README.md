# @fliwright/cloud-worker

设备电脑上的 Node.js 常驻 Worker，通过 CLI 启动并主动连接统一 Cloud Server。
不需要在设备电脑运行 Cloud Server、SQLite 或管理页面。

## 启动

需要 Node.js 26+。执行器支持 macOS/Unix 进程组；iOS 需要 macOS、Xcode 和对应 runtime，Android 需要 Android SDK。执行 Flutter 测试还需要 Flutter、仓库访问凭据和专用可重置设备。

仓库开发环境：

```sh
pnpm install
pnpm --filter @fliwright/cloud-worker... build
node packages/fliwright-cloud-worker/dist/main.js --help
node packages/fliwright-cloud-worker/dist/main.js run /PRIVATE/PATH/worker.json
```

部署到另一台电脑时，先构建，再导出仅含生产依赖的独立目录：

```sh
pnpm --filter @fliwright/cloud-worker deploy --legacy --prod /NEW/worker-runtime
```

将整个目录复制到设备电脑，配置环境变量与设备工具后运行：

```sh
export PATH="/PATH/worker-runtime:$PATH"
fliwright-worker run /PRIVATE/PATH/worker.json
```

运行目录内含 `fliwright-worker` 启动器；将运行目录加入 `PATH` 后，配对和 Worker 子命令都可直接使用。也可通过安装包提供的同名 bin 启动。当前包仍为私有 workspace 包，尚未发布 npm；不要直接使用 `npm install -g @fliwright/cloud-worker` 作为已可用的安装流程。

## 配置和命令

Worker 根据 `serverUrl` 主动建立 `/api/worker/connect` WebSocket 连接（HTTPS 自动使用 WSS）。任务、扫描、设备清单、执行心跳和取消通知共用一个控制连接；空闲时等待 Server 的队列变化通知，不定时领取任务。旧 `pollMs` 配置已移除。报告文件及发布创建仍通过 HTTPS 上传。打包机只需出站访问公网 Server，无须公网 IP、端口映射或反向隧道；反向代理须转发 Upgrade 和 Authorization，模板见 Cloud 包的 `deploy/nginx.conf.example`。

Server 每 10 秒发送 WebSocket ping 保活，执行租约仍以默认 5 秒的执行心跳续租；设备在启动、WS 重连及本机状态变化时立即扫描上报，每 30 秒校准和续期。Android 使用 `adb track-devices`，iOS 真机使用 `xcdevice observe --both`，iOS 模拟器监听状态文件变化；事件合并 150ms，扫描和上报串行进行。原生监听失败会重试，周期扫描保留工具诊断；退出时停止监听进程。空闲连接断开后指数退避重连（上限约 30 秒并带抖动），不重放结果未知的请求；鉴权拒绝停止重连。执行中断线会终止所拥有的进程并保留槽位锁，需要显式 `recover`，重连不代表恢复设备租约。扫描断线也会中止，未完成扫描由原有租约过期处理。

管理员可以在 Cloud 的 Worker 主机页面生成十分钟有效的一次性配对码，然后在打包机上运行：

```sh
fliwright-worker pair https://cloud.example.com /PRIVATE/PATH/cloud-worker
```

CLI 会在终端安全地提示输入配对码，并在新建的私有目录中保存 `credentials.json` 和 `worker.json`（目录权限 `0700`，文件权限 `0600`）。配对后运行 `fliwright-worker run /PRIVATE/PATH/cloud-worker/worker.json`，再在网页为设备选择允许的应用并保存。Cloud 自动纳管、启用设备并分配槽位；本机常驻 Worker 自动同步绑定、收集测试目录和启动独立执行器，无需重复填写身份、设备 ID 或运行目录。Cloud 数据库只保留凭据摘要。管理员可撤销已配对主机，撤销会关闭其 WSS 连接。

已有静态部署仍可复制 `deploy/worker.example.json` 到仓库外私有目录。`tokenEnv` 指定环境变量认证；配对 Worker 使用绝对路径 `credentialFile`。两种来源必须恰好配置一种。服务端登记 SHA-256 token 摘要与 Worker ID。不同电脑使用不同 Worker ID 和凭据。Server 配置示例见 [Cloud README](../fliwright-cloud/README.md)。

| 命令 | 行为 |
| --- | --- |
| `fliwright-worker run worker.json` | 发现设备、扫描仓库，自动跟随网页绑定管理执行器并上传结果 |
| `fliwright-worker pair <server-url> <new-directory>` | 交互输入一次性配对码，保存私有凭据和 discovery 配置 |
| `fliwright-worker discover discovery.json` | 只检测上报，不需要执行目录、槽位或 reset 配置 |
| `fliwright-worker recover worker.json` | 核查原进程已停止、终止其拥有的进程组、重置设备并请求恢复隔离槽位 |
| `fliwright-worker retry-uploads worker.json` | 重传保留的报告，不重新执行测试或更改结论 |

所有命令均从环境变量读取凭据。`discover` 配置见 `deploy/discovery.example.json`，可选 `deviceTools: { adb, emulator, xcrun }` 指定扫描工具路径。扫描包含 iOS/Android 真机与模拟器，不自动启动或擦除设备。

最小配对配置可直接用于 `run`。工作目录默认是配置文件旁的 `runtime/`，每个槽位的生成配置、锁和 spool 位于 `runtime/slots/<slotId>/`。网页修改应用范围无需重启 Worker；取消纳管或禁用设备会停止对应执行器。已有纳管设备缺少槽位时，同步会自动补齐。iOS 模拟器自动启动，默认在任务前后 shutdown → boot → bootstatus，保留数据，不执行 erase；真机及其他平台需在主机配置 `resetCommands`。显式设备配置仍用于自定义执行及 `recover` / `retry-uploads`；恢复自动槽位时将其生成的 `worker.json` 传给 `recover`。隔离槽位和保留的锁不会被自动清除或重放。原生设备不得被多个槽位占用。

`run` 启动独立的仓库目录扫描控制循环。扫描不占用设备槽位；网页已纳管、启用设备的应用关联自动授权该主机扫描对应项目。Server 的 `catalogProjects` 可额外授权纯扫描主机。只有该 Worker 的只读凭据映射可用时，才在 `repositoryCredentialHomes` 中加入引用，例如 `{ "gitlab-readonly": "/private/worker/git-home" }`。目录收集器使用临时最小环境、独立进程组、固定 SHA、无 hook 的 checkout、5 分钟超时和 4 MiB 输出上限；测试模块顶层代码仍属于可信仓库代码，会在此隔离进程内导入。扫描器不接收 Cloud bearer token 或设备地址。`discover` 是明确的仅设备发现模式，不扫描或执行任务。

### 使用当前本地构建扫描 workspace 项目

如果应用通过 `workspace:*` 引用本机 Fliwright，独立 checkout 无法读取原来的兄弟目录。在 Fliwright 仓库打包当前构建：

```sh
node scripts/pack-local-packages.mjs /NEW/local-build-bundle
```

该命令构建 CLI、Vitest、Riverpod 插件及其 workspace 依赖，输出 tarball 和带 SHA-256 的 `packages.json`，并固定为这批构建所使用的 Vitest 版本。将整个 bundle 放在 Worker 主机的持久目录，在 Cloud 项目的安装命令中配置：

```json
{
  "program": "/ABSOLUTE/PATH/node",
  "args": [
    "/ABSOLUTE/PATH/fliwright-worker",
    "install-local-packages",
    "/ABSOLUTE/PATH/local-build-bundle/packages.json"
  ]
}
```

Worker 主机需要 npm 和 npm registry 访问。每次安装先校验 tarball 摘要，再在 checkout 内建立独立的临时安装目录：本地包和传递引用统一指向这批 tarball，应用的其他生产和开发依赖从 registry 安装，生命周期脚本禁用。原始 `package.json` 和 `pnpm-workspace.yaml` 保留；安装文件均在 checkout 内，之后的只读保护不会修改主机缓存。第三方下载缓存在 bundle 旁的 `npm-cache/`，中断后可复用已完成下载；bundle 目录需允许 Worker 写缓存。该安装命令要求 checkout 尚无 `node_modules`，应代替普通的 Node 依赖安装步骤。扫描完成会一并清理依赖；包更新时生成新的 bundle 并更新 Cloud 安装命令，配置版本随之递增。

## 生命周期与常驻运行

终端启动后 Worker 常驻，SIGINT/SIGTERM 请求停止；正在执行的任务按原有取消、证据导出和清理流程结束。崩溃、失联或清理失败会保留 `slot.lock`，需要显式 `recover`，不要手动删锁。

macOS 使用 `deploy/com.fliwright.cloud.worker.plist` 模板交给 launchd。替换 Node、Worker 目录、Flutter、PATH、配置、日志和凭据；在可使用 Simulator 的登录用户会话运行。Linux 可由 systemd 运行同一个 CLI；iOS Worker 必须部署在 Mac 上。进程管理器负责开机启动与异常重启，Worker 本身不安装后台服务。

## 包职责

- `@fliwright/cloud-worker`：本机设备上报、任务执行、进程监督、重置与报告上传。
- `@fliwright/devices`：可复用的本机设备扫描，不依赖 Cloud。
- `@fliwright/cloud-protocol`：共享协议、WebSocket 控制客户端、HTTP 上传客户端和上传路径约束，不依赖设备扫描或 Server。
- `@fliwright/cloud`：集中队列、租约、设备策略、报告与管理页面。Worker 的 Cloud devDependency 仅用于真实网络集成测试，不进入生产部署。

## 扫描失败诊断

Cloud 的扫描记录保留阶段与可处理的失败原因：Git 认证、缺少依赖、未声明场景、只读 checkout 写入、超时和资源限制。任意仓库 stderr 不会直接发布，未知错误使用通用提示。

扫描和测试执行会在各自的临时 checkout 中自动移除指向仓库外部、目标缺失或循环引用的符号链接，再继续处理测试和代码；仓库内有效的文件、目录及链式链接会保留。扫描安装依赖后会再次清理，再将源码设为只读。原始 Git 仓库和链接指向的本机内容不会被修改，无需为了本机技能目录等链接重新提交。如果测试或构建实际依赖被移除的内容，仍需将依赖放入仓库或通过安装命令提供。
