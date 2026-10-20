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
node /PATH/worker-runtime/dist/main.js run /PRIVATE/PATH/worker.json
```

也可由安装包提供的 `fliwright-cloud-worker` bin 启动。当前包仍为私有 workspace 包，尚未发布 npm；不要直接使用 `npm install -g @fliwright/cloud-worker` 作为已可用的安装流程。

## 配置和命令

复制 `deploy/worker.example.json` 到仓库外私有目录。`serverUrl` 指向共享 Server，`tokenEnv` 指定保存 bearer token 的环境变量名；服务端登记该 token 的 SHA-256 与 Worker ID。不同电脑使用不同 Worker ID 和凭据。Server 配置示例和凭据生成见 [Cloud README](../fliwright-cloud/README.md)。

| 命令 | 行为 |
| --- | --- |
| `fliwright-cloud-worker run worker.json` | 周期检测并上报整机设备，轮询一个配置槽位，执行任务并上传结果 |
| `fliwright-cloud-worker discover discovery.json` | 只检测上报，不需要执行目录、槽位或 reset 配置 |
| `fliwright-cloud-worker recover worker.json` | 核查原进程已停止、终止其拥有的进程组、重置设备并请求恢复隔离槽位 |
| `fliwright-cloud-worker retry-uploads worker.json` | 重传保留的报告，不重新执行测试或更改结论 |

所有命令均从环境变量读取凭据。`discover` 配置见 `deploy/discovery.example.json`，可选 `deviceTools: { adb, emulator, xcrun }` 指定扫描工具路径。扫描包含 iOS/Android 真机与模拟器，不自动启动或擦除设备。

`run` 的 `workerId`、`slotId`、`deviceId` 必须与 Server 登记及网页纳管策略匹配；`root` 保存进程归属锁与 spool；`resetCommands` 必须针对专用设备明确配置，任务前后均会执行。reset 示例会擦除 iOS 模拟器。网页纳管不会自动创建本机执行进程；每个执行槽位仍需独立配置、root 和进程。同一主机的槽位实例可使用同一个主机身份；原生设备不得被多个槽位占用。

## 生命周期与常驻运行

终端启动后 Worker 常驻，SIGINT/SIGTERM 请求停止；正在执行的任务按原有取消、证据导出和清理流程结束。崩溃、失联或清理失败会保留 `slot.lock`，需要显式 `recover`，不要手动删锁。

macOS 使用 `deploy/com.fliwright.cloud.worker.plist` 模板交给 launchd。替换 Node、Worker 目录、Flutter、PATH、配置、日志和凭据；在可使用 Simulator 的登录用户会话运行。Linux 可由 systemd 运行同一个 CLI；iOS Worker 必须部署在 Mac 上。进程管理器负责开机启动与异常重启，Worker 本身不安装后台服务。

## 包职责

- `@fliwright/cloud-worker`：本机设备上报、任务执行、进程监督、重置与报告上传。
- `@fliwright/devices`：可复用的本机设备扫描，不依赖 Cloud。
- `@fliwright/cloud-protocol`：共享协议、HTTP 客户端和上传路径约束，不依赖设备扫描或 Server。
- `@fliwright/cloud`：集中队列、租约、设备策略、报告与管理页面。Worker 的 Cloud devDependency 仅用于真实 HTTP 集成测试，不进入生产部署。
