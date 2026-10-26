# Cloud 部署与运维

## 目录约定

程序入口与工作目录无关，使用绝对配置路径即可在任何目录启动。

| 内容 | macOS 示例 | Linux 示例 |
| --- | --- | --- |
| Server 程序 | `~/services/fliwright-cloud/` | `/opt/fliwright-cloud/` |
| 私有配置 | `~/.config/fliwright-cloud/server.json` | `/etc/fliwright-cloud/server.json` |
| SQLite / 报告 | `~/Library/Application Support/FliwrightCloud/server/` | `/var/lib/fliwright-cloud/` |
| 进程监督 / 日志 | launchd / `~/Library/Logs/` | systemd / journald |

在开发机执行 `pnpm cloud:deploy /NEW/RELEASE/PATH`，把生成目录复制到目标机器。
Worker 使用 `pnpm cloud:deploy-worker /NEW/WORKER/RELEASE/PATH`，独立部署在设备主机。
构建机与目标机须使用相同操作系统和架构，目标机需要 Node 26+。

## 配置

本机试用：`node /PATH/fliwright-cloud init /PRIVATE/CONFIG/DIRECTORY`，生成 loopback
模式配置。团队部署从 `server.example.json` 复制配置，设置 publicUrl、用户、仓库主机
allowlist 和 dataRoot；使用 `env:` 引用运行环境中的 proxy/publication secrets。
Linux 模板设置 `dataRoot` 为 `/var/lib/fliwright-cloud`，运行账户为 `fliwright`。
配置目录权限 0700，配置和环境文件权限 0600，运行账户须能读配置、写数据目录。

团队浏览器登录沿用 `nginx.conf.example` + GitLab OIDC；Server 监听 loopback，
不要保留本地试用配置里的 `localUser`。代理转发 Worker WebSocket Upgrade。
`publicationSecret` 必须稳定保存，后续启动和上传重试继续使用同一值。

## macOS launchd

复制 `com.fliwright.cloud.server.plist` 到运行账户的 `~/Library/LaunchAgents/`。
替换模板中的 Node 绝对路径、部署目录、配置、日志和私有环境变量；创建日志目录并把
plist 权限设为 0600。Node 可通过 `command -v node` 确认，必须为 26+。

```sh
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.fliwright.cloud.server.plist"
launchctl print "gui/$(id -u)/com.fliwright.cloud.server"
tail -n 80 "$HOME/Library/Logs/fliwright-cloud-server-error.log"
```

停止和重启：

```sh
launchctl bootout "gui/$(id -u)/com.fliwright.cloud.server"
# 更新部署目录或 plist 后重新 bootstrap
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.fliwright.cloud.server.plist"
```

模板在登录时启动，异常退出后自动重试；主动正常退出不会反复拉起。
这是 User Agent，重启后仍需该运行账户登录。iOS Worker 使用自己的 launchd 模板及
独立 root/槽位，避免共享本地 `slot.lock`；故障后先按 Worker recover 流程核查。

## Linux systemd

创建专用 `fliwright` 运行账户，将程序部署到 `/opt/fliwright-cloud`，配置存放到
`/etc/fliwright-cloud/server.json`。创建仅该运行账户可读的
`/etc/fliwright-cloud/server.env`，写入 `FLIWRIGHT_CLOUD_PROXY_SECRET=...` 和
`FLIWRIGHT_CLOUD_PUBLICATION_SECRET=...`，与 JSON 中的 `env:` 引用保持一致。
复制 `fliwright-cloud.service` 到 `/etc/systemd/system/`，将 ExecStart 的 Node 路径
替换为实际 Node 26+ 路径。`StateDirectory` 会创建 `/var/lib/fliwright-cloud`。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now fliwright-cloud
sudo systemctl status fliwright-cloud
sudo journalctl -u fliwright-cloud -n 80 --no-pager
```

```sh
sudo systemctl stop fliwright-cloud
sudo systemctl start fliwright-cloud
```

## 健康检查与升级

```sh
node /PATH/fliwright-cloud health /PRIVATE/PATH/server.json
```

命令检查配置的后端 `/healthz`，5 秒超时，失败返回非零。它不验证 HTTPS 身份代理、
设备在线或任务执行结果；团队部署还需检查公开网页及 Worker 连接。

升级时先停止 Worker 和 Server，对 SQLite 和报告做一致备份，保留原私有配置。
使用新的部署目录替换代码路径，启动 Server 并检查 health，再按需恢复 Worker。
不要把配置、数据库、报告或 spool 放在版本发布目录内。
