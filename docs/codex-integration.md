# 在 Codex 中集成 Fliwright

Fliwright 通过 **Skills + CLI** 接入 Codex。开发者安装 Skills、准备目标 Flutter 项目后，即可让 AI Agent 检查页面、操作 App、编写测试和分析失败证据。Fliwright 的 MCP server 和 `fliwright mcp` 已移除，无需添加 Fliwright MCP 配置。

```text
开发者描述任务
  → Codex 读取匹配的 Skill
  → 通过终端执行目标项目的 Fliwright CLI
  → CLI 通过 Dart VM Service 连接 App 内的 fliwright_bridge
  → Codex 读取 JSON、截图和测试产物，继续操作或报告结果
```

## 快速选择

| 使用场景 | 接入方式 |
| --- | --- |
| 首次接入 Flutter 项目；桌面端、CLI 或 IDE 扩展 | [一条命令集成](#推荐一条命令集成) |
| 需要安装全套插件 Skills（含 GitLab 测试计划等） | [从 GitHub marketplace 安装插件](#方式一安装-codex-插件) |
| 自定义 Skill 分发或其他 Agent 工具 | [直接安装 Skills](#方式二直接安装-skills) |
| 开发者首次接入 Flutter 项目 | 完成 [Flutter 项目准备](#准备目标-flutter-项目)，再进行[首次连接](#首次连接与页面检查) |
| AI Agent 已经获得 Skills | 从 [Agent 执行约定](#ai-agent-执行约定)开始 |

插件安装、项目依赖安装、Flutter bridge 接入是三个独立步骤。安装插件不会自动为目标项目安装 CLI，也不会自动修改或启动 Flutter App。

## 推荐：一条命令集成

在目标 Flutter 项目根目录执行：

```sh
npx --yes --package=@fliwright/cli@latest fliwright init --agent codex --yes
```

这条命令通过公开 npm 包获取安装器，自动完成项目依赖安装、Flutter bridge 专用入口、缺失配置与示例文件创建，并安装 Codex 所需的三个自动化 Skills 及 `AGENTS.md` 指令。Skills 随 CLI 发布到 npm，无需克隆 Fliwright、安装 Codex CLI、配置 marketplace 或手动复制文件。

**发布条件：**需要发布包含此功能的 `@fliwright/cli` 及其依赖，并在 pub.dev 发布匹配的 bridge。尚未发布时，公开安装命令不能使用工作区中的新功能；维护者应先按[发布指南](./release/publishing.md)发布并验证干净安装。

完成后在该项目中新建 Codex 聊天，输入“使用 Fliwright 启动 App，检查当前页面并截图”。Node、Flutter SDK、设备及项目构建环境需事先可用；安装完成不代表 App 已运行或在线验证成功。

### Flavor、机器调用与重复执行

```sh
# 默认入口为 lib/main.dart；其他入口显式指定
npx --yes --package=@fliwright/cli@latest fliwright init --agent codex --yes --entrypoint lib/main_dev.dart

# AI Agent/CI 使用结构化结果
npx --yes --package=@fliwright/cli@latest fliwright init --agent codex --yes --json

# 只生成文件，暂不安装依赖
npx --yes --package=@fliwright/cli@latest fliwright init --agent codex --install false --json
```

初始化不弹出交互问题；`--yes` 明确使用默认值，缺少默认 App 入口时要求显式指定。`npx --yes` 接受 npm 下载确认，`fliwright init --yes` 控制初始化语义。包管理器按项目声明/lockfile 检测，也可用 `--pm pnpm` 等显式指定。

返回结果中：

| 字段 | 含义 |
| --- | --- |
| `status` | `configured` 表示安装命令完成且静态引用检查通过；`needs-attention` 表示仍有待处理步骤 |
| `runtimeVerified` | 始终为 `false`；初始化不会启动设备或进行 App 验证 |
| `checks` / `nextSteps` | 已完成的检查和需要处理的配置、依赖或验证步骤 |
| `agent.skills` / `agent.conflicts` | 完整安装的 Skills，以及保留的自定义文件或同名 Skill 路径 |
| `created` / `updated` / `skipped` / `commands` | 文件变更与尝试执行的依赖安装命令 |

重复执行会保留已有配置、bridge 入口和 `AGENTS.md` 管理区块之外的内容。Skills 的初始哈希记录于 `.agents/skills/.fliwright-managed.json`，未改动的托管资源可自动更新；已自定义的资源和非托管同名 Skills 保留并报告冲突。将 Skills 与该状态文件一起提交，便于团队复现与升级；标记区块内的 Agent 指令由初始化器维护。

现有 Vitest 配置缺少 preset、Node 配置不是 ESM/指定 Vitest 版本，或 bridge 入口不匹配时，安装器列出待处理项，避免覆盖自定义配置。这里仅检查静态引用，仍需 `doctor --strict`、Dart 分析和真实 App 验证。依赖安装失败退出 3，并在 JSON `data` 中保留进度；修复 registry/工具问题后重跑同一命令即可。待处理配置可在退出 0 时返回，Agent 必须读取 `status` 和 `checks`。

已通过此方式完成接入的用户可跳到[首次连接与页面检查](#首次连接与页面检查)。下面的插件和手动复制是可选的分发方式。

## 环境要求

- Node.js 22.12+（22.x）、24.x 或 26+，以及项目使用的 npm/pnpm。
- Flutter 3.x、Dart 3.5+，能够修改目标 App 源码。
- Codex 可以在目标项目目录执行终端命令，并访问设备上的 Dart VM Service。
- 在线检查使用已接入 `fliwright_bridge` 的 Flutter debug/test 构建。仅发现 CLI 命令、生成草稿或读取已有产物时，无需运行 App。

本文的 `/absolute/path/to/...`、`VM_URL`、`SESSION_ID`、`RUN_ID`、测试文件、场景名和 Widget Key 均为占位内容，必须替换为实际值。CLI 示例从**目标 Flutter 项目根目录**执行；插件维护命令从 **Fliwright 仓库根目录**执行。

## 方式一：安装 Codex 插件

社区用户通过公开的 [GitHub 仓库](https://github.com/0x01lab/fliwright) 安装。使用与 Codex 桌面端相同本机环境中的 Codex CLI 注册并安装，无需预先克隆 Fliwright 仓库：

```sh
codex plugin marketplace add https://github.com/0x01lab/fliwright.git --ref main
codex plugin add fliwright@fliwright
```

`fliwright@fliwright` 的前半部分是插件名，后半部分是 marketplace 名，定义于仓库的 [marketplace manifest](../.agents/plugins/marketplace.json)。Codex 从 GitHub 获取目录，并按 `git-subdir` 源安装 `plugins/fliwright` 中的插件。安装命令使用公开 HTTPS 地址，不依赖维护者本机路径或 SSH 凭据。

此方式是通过 GitHub 分发社区插件。若希望用户直接在 OpenAI 公共插件目录搜索安装，还需按官方流程另行提交和发布；GitHub marketplace 可安装不代表已经上架公共目录。

安装后，在 Codex 中打开目标 Flutter 项目并**新建聊天或 CLI 会话**。可以在插件界面查看 Fliwright；CLI 中也可使用 `/plugins`。如果本机不识别插件命令，先检查 `codex plugin --help`，或采用下面的直接安装 Skills 方式。

### 更新插件

```sh
codex plugin marketplace upgrade fliwright
codex plugin add fliwright@fliwright
```

更新后新建聊天或 CLI 会话。`main` 提供当前公开版本；需要固定版本的团队，应由维护者发布同时固定 marketplace 和插件源 `ref`/`sha` 的版本配置，避免只固定 marketplace 而插件仍跟随 `main`。

主要 Skills 的职责：

| Skill | 何时使用 |
| --- | --- |
| `fliwright-cli-workflows` | 连接 App、检查页面、交互、录制、运行测试、读取产物、持久 TDD 执行 |
| `write-fliwright-tests` | 编写、修改和检查 TypeScript 自动化测试与脚本 |
| `write-fliwright-mock-rules` | 编写项目共享 / Item 专属 HTTP Mock JSON，校验规则与单目录索引 |
| `gitlab-test-plan` | 将 GitLab 验收标准转换为测试计划，并绑定自动化用例 |
| `fliwright-tdd` | 在 Fliwright 仓库中修改框架源码时进行测试驱动开发 |

## 方式二：直接安装 Skills

Codex 会扫描目标仓库中的 `.agents/skills/`。不使用插件时，可从公开仓库取得 Skills 并复制到目标项目，**保留 references、examples 等子目录**。下面的 `FLIWRIGHT_REPO` 应指向尚不存在的下载目录：

```sh
FLIWRIGHT_REPO=/absolute/path/to/fliwright
FLUTTER_PROJECT=/absolute/path/to/flutter-project
git clone --depth 1 https://github.com/0x01lab/fliwright.git "$FLIWRIGHT_REPO"
mkdir -p "$FLUTTER_PROJECT/.agents/skills"
cp -R "$FLIWRIGHT_REPO/.agents/skills/fliwright-cli-workflows" "$FLUTTER_PROJECT/.agents/skills/"
cp -R "$FLIWRIGHT_REPO/.agents/skills/write-fliwright-tests" "$FLUTTER_PROJECT/.agents/skills/"
cp -R "$FLIWRIGHT_REPO/.agents/skills/write-fliwright-mock-rules" "$FLUTTER_PROJECT/.agents/skills/"
```

以上是首次安装示例；目标已有同名目录时，先检查其自定义内容再更新。团队可以提交复制后的 Skills，统一使用同一版本。其他支持 Agent Skills 的 AI 编码工具也可复用这些目录，安装位置遵循各工具自己的规则。

若要在本机所有项目中使用独立 Skills，可以放在 `~/.agents/skills/`；Codex 也支持链接到源目录的符号链接。团队共享时优先采用可随仓库分发的文件，避免依赖个人绝对路径。相同 Skill 同时从插件和直接目录加载时可能重复出现，选择一种分发方式即可。

在 Fliwright 本仓库开发时，根目录 `.agents/skills/` 已提供这些 Skills，无需为本仓库再次复制。新增 Skill 未显示时，重新打开会话；仍未生效再重启 Codex。

## 准备目标 Flutter 项目

已有 Fliwright 配置和 bridge 的项目可跳到下一节。新项目以 npm 为例：

```sh
cd /absolute/path/to/flutter-project
npm install --save-dev @fliwright/cli @fliwright/vitest vitest@5.0.5 typescript
npx --no-install fliwright init --pm npm --json
```

如果项目使用 pnpm，则沿用该项目的包管理器：

```sh
pnpm add -D @fliwright/cli @fliwright/vitest vitest@5.0.5 typescript
pnpm exec fliwright init --pm pnpm --json
```

后续示例使用 `npx --no-install fliwright`；pnpm 项目可替换为 `pnpm exec fliwright`。始终使用项目安装的版本。

`init` 会创建缺失的配置、示例测试和脚本，并补充 `package.json`、忽略规则。在有 `pubspec.yaml` 的目录中，它还会生成 `test_driver/fliwright_app.dart`，默认执行依赖安装和 `flutter pub add fliwright_bridge`。已有 scaffold 文件会保留，检查返回的 `created`、`updated` 和 `skipped`。

需要先检查生成内容时，可使用 `init --install false --json`；这会写入 scaffold，但不会安装 Node/Dart 依赖。之后仍需使用项目包管理器安装 Node 依赖，并添加或配置 `fliwright_bridge` 的 Dart 依赖。

重点检查：

- `fliwright.config.ts`：测试路径、超时和项目场景声明。
- `vitest.config.ts`：使用 `fliwrightPreset(projectConfig)`；已有 Vitest 配置需要合并 Fliwright preset。
- `test_driver/fliwright_app.dart`：生成入口默认调用 `lib/main.dart`；按项目实际 flavor、启动参数和初始化方式调整。
- `.fliwright/tests/example.test.ts`：示例 Counter 控件仅作演示，替换为 App 的真实控件和断言。

启动 bridge 专用入口，并保持该 Flutter 进程运行：

```sh
flutter run -t test_driver/fliwright_app.dart
```

从启动输出取得当前 Dart VM Service WebSocket URL，在另一个终端或 Agent 命令环境中设置：

```sh
export VM_URL='ws://HOST:PORT/ACTUAL_AUTH_TOKEN/ws'
npx --no-install fliwright schema --json
npx --no-install fliwright doctor --vm-url "$VM_URL" --strict --json
```

URL 中的端口和认证路径来自本次启动，不能复制文档占位值或上次启动的值。Agent 应在实际调用中传递 URL，不要假定不同终端调用共享之前的 `export`。不要将本地端点写入版本控制。平台验证范围和构建约束见[兼容性](./release/compatibility.md)与[安全模型](./release/security.md)。

## 首次连接与页面检查

先建立可复用连接：

```sh
npx --no-install fliwright session open --vm-url "$VM_URL" --json
```

读取结果，确认 `ok: true`，将 `data.sessionId` 作为后续命令的 `SESSION_ID`。它不是测试运行的 `runId`。

```sh
SESSION_ID='REPLACE_WITH_DATA_SESSION_ID'
npx --no-install fliwright app snapshot --session "$SESSION_ID" --json
npx --no-install fliwright schema app.interact --json
```

根据快照发现真实目标后交互。以下 Key 仅为示例，必须替换为当前 App 中存在的 Key：

```sh
npx --no-install fliwright app interact tap --key 'profile-tab' --session "$SESSION_ID" --json
npx --no-install fliwright app snapshot --session "$SESSION_ID" --json
npx --no-install fliwright app screenshot --session "$SESSION_ID" --json
```

截图返回文件路径 `data.path`，Agent 应使用图像读取工具打开它。快照中的 ref 是当前 App/isolate 的临时句柄；重启后重新获取，持久测试使用稳定 Key、semantics 或文本 locator。

完成后释放连接：

```sh
npx --no-install fliwright session close --session "$SESSION_ID" --json
```

单次检查也可直接给 `app snapshot` 传 `--vm-url`；反复探索时使用 session。所有 session 命令保持相同项目目录，并显式传入 session ID。

可以直接向 Codex 提出任务：

> 使用 Fliwright 检查当前运行的 Flutter App。先读取 CLI schema，再建立 session，说明当前页面内容，截图检查，完成后关闭 session。连接端点使用本次启动的 VM Service URL。

> 使用 Fliwright 为个人中心编写回归测试。先检查项目已有 fixture、场景和控件 Key，复用具名登录场景，运行测试，并根据保存的产物报告结果。

## 运行测试与保留证据

先将真实业务步骤和断言写入 `.fliwright/tests/*.test.ts`。场景用于提供可重复的初始状态：

```sh
npx --no-install fliwright scenario list --json
npx --no-install fliwright scenario resolve logged-in --json
npx --no-install fliwright run \
  --test .fliwright/tests/profile.test.ts \
  --scenario logged-in \
  --vm-url "$VM_URL" \
  --runs-root artifacts/runs \
  --junit-output artifacts/junit.xml \
  --json
```

`logged-in` 和测试文件必须已在目标项目中定义；不需要场景的简单测试可省略 `--scenario`。业务登录态通过具名、组合的 `TestScenario` 调用 App 自有的 `auth.seedLoggedIn` 准备。它是 App 需提供的能力；不通过真实登录、验证码绕过或通用 Riverpod auth override 准备业务测试。

`run --scenario` 会在每次测试 attempt（包括重试）前应用场景。手动 `scenario apply` 适合探索，不能代替测试 attempt 的初始化。

GitLab Item 验收可复用 `.fliwright/mocks/api/` 的共享响应，只将专属数据放入
`.fliwright/test-plans/<iid>/mocks/api/`。通过命名场景的 `sources` + `rules` 显式
组合；覆盖已有 method/endpoint 时写 `replace: true`。认证仍使用 App 自有能力，
KYC、余额等业务状态由 Mock 返回。组合场景会在每次 attempt 前替换全部 App Mock
路由（包含编辑器临时规则）并清理记录；混合场景的文件用每条 `test.scenario(name)`
选择，省略冲突的全局 `--scenario`。目录、代码与迁移步骤见
[共享与 Item Mock 指南](./mock-rule-sets.md)。

`scenario resolve` 不读取端点 JSON；离线文件校验使用 core `resolveMockRuleSet`。
真实运行的 timeline `mockRuleSet` 记录规则来源和文件摘要，不能用离线校验或规则
摘要代替测试通过结论。

`run`、`script`、`record` 使用独立的有限连接，不复用 `--session`。本例显式将运行证据写入 `artifacts/runs`，CI 应在失败或取消时也上传产物，并保留原始退出码。

从运行结果的 `data.artifacts.runId` 取得运行 ID，再离线读取：

```sh
RUN_ID='REPLACE_WITH_DATA_ARTIFACTS_RUN_ID'
npx --no-install fliwright artifacts show "$RUN_ID" --runs-root artifacts/runs --json
npx --no-install fliwright artifacts failures "$RUN_ID" --runs-root artifacts/runs --json
npx --no-install fliwright schema artifacts.timeline --json
```

离线读取无需运行 Flutter。查询使用与运行时相同的 `--runs-root`，多测试/多 attempt 的时间线按 schema 指定 `testId` 和 `attemptId`。未显式配置时，运行数据默认位于用户目录的 `~/.fliwright/<project-path>/` 分区；以实际命令返回的路径为准。作者编写的测试、脚本、Mock 和 Flow 文件保留在项目中。

## AI Agent 执行约定

1. 阅读目标项目 `AGENTS.md`、已有 Fliwright 配置和匹配的 Skill。CLI Skill 从命令索引进入，只读本次任务需要的命令页；测试或脚本编辑同时使用 `write-fliwright-tests`。
2. 从目标项目根目录调用已安装的 CLI。先执行 `schema --json`，再用 `schema <command.path> --json` 确认具体参数；schema 使用 `app.interact` 这样的点分命令路径。
3. 先读环境和 UI，再修改 App 状态。反复探索使用 session，显式传递返回的 session ID；不要混用不同 App、目录或重启前的 ref。
4. 优先 `--json`。同时检查进程退出码、envelope `ok` 和命令特有的状态字段；失败时仍读取 `data` 中的证据。`doctor` 使用 `--strict` 判断必需检查是否通过。
5. 嵌套输入使用 `--input file.json` 或 `--input -`，字段为 camelCase；不要将输出 envelope 原样作为输入，也不要同时用 flag 和 JSON 重复提供同一字段。
6. 修改测试前复用已有 fixture 和具名场景。持久化稳定 locator、业务断言和产物引用；临时 ref 不进入测试代码。
7. 请求响应丢失或超时时，先查询操作 journal 再决定是否重试，避免重复执行点击、提交等状态修改。
8. 截图返回路径后实际打开图片；测试失败先读取失败和时间线证据。报告实际完成的步骤、runId/产物路径和剩余阻碍；缺少 App 时可完成离线工作，但不声称在线验证通过。
9. 结束时关闭自己创建的 session。若使用持久 TDD，按工作流先停止 TDD；attach session 需先 `tdd start`，managed `session open --device-id` 已自动启动 TDD。

### 可复制到目标项目的 AGENTS.md

将下面片段合并到已有文件，并补充项目自己的入口、场景名及测试 fixture 位置：

```md
## Flutter 自动化：Fliwright

- 使用 Skills + 项目本地 CLI。CLI 操作读 fliwright-cli-workflows；测试/脚本编辑同时读 write-fliwright-tests；Mock 文件编辑读 write-fliwright-mock-rules。
- 命令从 Flutter 项目根目录执行，使用 pnpm exec fliwright 或 npx --no-install fliwright。
- 先 schema --json，再 schema <command.path> --json。不要推测 flag 或 bridge 方法。
- 在线操作需要 bridge 专用入口和当前 VM Service URL。反复探索建立 session，所有后续调用显式传 --session，结束时关闭。
- 所有调用优先 --json，同时检查退出码、ok 和命令结果状态。截图按 data.path 打开，失败时保留并读取 data/artifacts。
- 测试放在 .fliwright/tests，脚本放在 .fliwright/scripts；复用项目 fixture、稳定 locator 和具名组合 TestScenario。
- 登录业务测试通过 App 自有 auth.seedLoggedIn 准备状态，使用 run --scenario 在每次 attempt 前初始化。
- run/script/record 不复用 session。CI 显式传 --runs-root 和 --junit-output，在失败时也上传产物。
- 操作超时或响应丢失先查 session status/journal，再决定是否重试状态修改。
- 不提交本地 VM URL、认证信息、截图缓存或运行产物。
```

### 响应丢失后的恢复

若已取得 `operationId`：

```sh
npx --no-install fliwright session status \
  --session "$SESSION_ID" --operation-id "$OPERATION_ID" --json
```

若未取得 operation ID，先执行 `session status --session "$SESSION_ID" --json`，查看 `data.operations`，再检查对应操作的 journal。活动列表为空也不能证明操作没有执行，应结合 App 状态和产物核实。

常用退出码：`0` 命令完成、`1` 测试/校验/评审失败、`2` 输入错误、`3` 环境不可用、`4` 工作流冲突、`5` deadline、`130` 取消。命令完成不一定代表业务目标已满足，仍需检查 readiness、partial、runnerErrors 等结果。

## 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| 安装插件后 Agent 看不到 Skills | 新建聊天/CLI 会话，确认插件启用；IDE 扩展使用直接安装 Skills 方式 |
| Agent 会读 Skill，但无法执行 CLI | 运行 `init --agent codex --yes` 准备项目运行环境，后续使用项目本地命令；插件本身不包含目标项目运行环境 |
| 依赖版本无法从 registry 安装 | 确认所用 Fliwright 版本已发布到项目配置的 registry；内部或源码版本沿用团队的 Node/Dart 依赖来源，安装 Skills 不会发布依赖 |
| `doctor` 完成但在线操作失败 | 使用 `doctor --strict --vm-url ... --json` 并查看 `data.checks`；确认启动的是 bridge 入口、URL 当前有效且网络可达 |
| 重启 App 后旧目标不能点击 | 重新抓取 snapshot，获取当前 App/isolate 的 ref |
| 找不到已保存的测试结果 | 使用返回的 runId、outputDir 和运行时相同的 runs root；session ID 不能作为 runId |
| 退出码为 0，但录制或评审仍不完整 | 检查 readiness、partial 和缺失证据；将生成结果视为待验证草稿 |
| 更新源码 Skill 后插件仍使用旧内容 | 插件安装使用缓存副本，按下面的维护流程同步并重新安装，再新建聊天 |

## Fliwright 插件维护

在 Fliwright 仓库维护者更新 `.agents/skills/` 后，从仓库根目录执行：

```sh
pnpm plugin:sync
node scripts/check-codex-plugin.mjs --skip-cli
```

社区发布使用公开 GitHub marketplace。维护者需要更新插件 manifest 的版本，提交并发布 `.agents/plugins/marketplace.json`、`plugins/fliwright/.codex-plugin/plugin.json` 与完整的 `plugins/fliwright/skills/`。公开 `main` 必须包含这套配置，用户才能使用前面的安装命令；仅修改本地工作区不会对社区用户生效。

从仓库根目录执行 `pnpm plugin:marketplace` 也会注册公开 GitHub 地址。它用于检查当前 checkout 的 manifest 并注册远程源，不负责推送代码或发布 Node/Dart 依赖。

`pnpm plugin:reload` 是会修改本地插件版本标记并重新安装的维护辅助命令；远程源安装仍读取 GitHub 已发布内容，不能验证尚未发布的工作区修改。社区更新使用前面的 `marketplace upgrade` 与 `plugin add`。完整发布步骤见[发布指南](./release/publishing.md#codex-community-plugin)。

## 进一步阅读

- [CLI 任务与命令索引](../.agents/skills/fliwright-cli-workflows/references/commands/index.md)：按任务查找命令，包含参数、结果和恢复说明。
- [CLI 公共约定](../.agents/skills/fliwright-cli-workflows/references/commands/common.md)：JSON envelope、生命周期与 CI。
- [测试编写 Skill](../.agents/skills/write-fliwright-tests/SKILL.md)：fixture、locator、断言和场景约定。
- [CLI 包说明](../packages/fliwright-cli/README.md)与[排障指南](./release/troubleshooting.md)。
- [插件冒烟任务](../plugins/fliwright/test-cases.md)：验证 Skill 选择和可观察结果。
- OpenAI 官方文档：[Skills](https://developers.openai.com/codex/skills/)、[Plugins](https://developers.openai.com/codex/plugins/)、[Git marketplace 与插件分发](https://developers.openai.com/plugins/build/plugins)。Codex 发现与安装行为核对日期：2026-11-03；具体命令以本机 `codex plugin --help` 和目标项目 CLI schema 为准。
