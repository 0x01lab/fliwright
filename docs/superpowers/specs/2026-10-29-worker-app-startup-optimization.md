# Worker App 启动加速设计

日期：2026-10-29。状态：待实施；本文是优化方案，不表示缓存或加速路径已经实现。

实施顺序见[实施计划](../plans/2026-10-29-worker-app-startup-optimization.md)。

## 1. 结论与范围

优先在 Worker 自己拥有的目录中复用 Flutter 构建环境，首先解决同一源码版本重复运行仍反复编译的问题。之后再实现跨提交增量编译、同一构建产物直接启动。设备重置优化单独推进，不以减少状态隔离换取构建性能。

分为三种执行路径：

| 路径 | 条件 | 行为 |
| --- | --- | --- |
| cold | 没有可信且匹配的准备环境 | 准备源码与依赖，正常 Flutter 编译、安装、启动 |
| warm | 同一版本、工具链及准备输入匹配，环境已通过完整性检查 | 复用固定绝对路径的工作区和构建缓存，正常 Flutter 增量编译、安装、启动 |
| binary | 后续阶段：构建输入完全一致，已验证对应产物 | 复用预编译 debug App，重新启动并取得本次 VM Service |

第一期交付 cold/warm 两种路径；binary 是第二期，必须通过 Flutter machine 模式的真实设备验证才能启用。第一期不接管开发者目录、已有 Flutter 进程或旧 VM Service。

## 2. 已测基线与现状

排查读取了本机 `ios-17-pro` 槽位保留的 Worker timeline 和 commands.log。以下是 5 次已完成启动的历史观测，不是控制变量实验，也不是优化后的预测：

| Attempt 前缀 | app.launch | 日志中的 Xcode build |
| --- | ---: | ---: |
| 94df9b74 | 189.024 秒 | 138.0 秒 |
| d918afb6 | 170.528 秒 | 125.1 秒 |
| fc66cf43 | 178.479 秒 | 135.0 秒 |
| e050f9d1 | 193.904 秒 | 134.1 秒 |
| ccd6580e | 169.958 秒 | 122.5 秒 |

这 5 次源码 commit 相同，但安装 bundle 或 Flutter 参数并非全部相同，不能把它们视为相同构建输入。启动前设备准备约 8 秒，代码准备另需约 12–19 秒；后两次测试本身约 33–35 秒。

源码事实：

- `cloud-worker/src/executor.ts`：每次在 `spool/<attemptId>/checkout` 执行 clone/fetch/checkout，校验固定 SHA，再安装依赖。
- Flutter 从入口所属 package 启动：例如仓库根执行测试，`apps/exio_app` 执行 `flutter run --machine`，不能把 monorepo 根误当 App 根。
- 每次新 checkout 都运行 pod install 和 Xcode build；每个旧目录虽保留自己的生成物，下次任务不会使用它们。
- `local-packages.ts` 会校验 tarball 摘要，但明确拒绝已经存在的 `node_modules`。
- `WorkerAgent` 已有每 slot 独占锁、租约监督、进程组终止核验、报告发布与设备清理。
- 默认 iOS simulator reset 是 shutdown/boot/bootstatus；前后各执行一次。它重启设备，但不会清空应用数据库、偏好设置或 Keychain。
- 时间轴已有阶段、子操作和里程碑，但 `app.launch` 内部没有编译/安装耗时明细。严格 schema 和服务端 phase-operation allowlist 必须一起更新。

主要优化机会是消除重复的本地原生编译。仅调低轮询间隔、跳过 pub get、加长超时，无法解决 120 秒以上的 Xcode 编译。

## 3. 目标和验收预算

以下是首轮工程验收目标，需要真实测量确认；未达到时根据阶段数据继续定位，不宣称已获得对应收益。

| 场景 | 首轮目标 |
| --- | --- |
| 第一期，同一完整输入 warm 启动 | app.launch 中位数 ≤ 45 秒，P95 ≤ 60 秒，且相对配对 cold 基线至少降低 60% |
| 第一期，领取任务到测试开始 | warm 中位数 ≤ 65 秒，P95 ≤ 90 秒；不包含排队和测试执行 |
| 第一期，新环境 cold | 相同条件下中位数相对 cold 对照不退化超过 10% |
| 第二期，binary 启动 | app.launch 中位数 ≤ 15 秒，P95 ≤ 30 秒 |
| 正确性 | 错误版本命中、跨任务报告污染、复用旧 VM 地址、遗留运行进程均为 0 |

每种主要场景至少 20 次有效样本；报告样本数、中位数、P95、最大值、缓存命中率、回退率及失败率。保留失败和异常慢样本，不通过排除失败运行美化数据。历史 5 次记录只用于确认优先级。

## 4. 模块归属和目录布局

新增 Worker 内部 `ExecutionWorkspace` module，集中处理身份计算、目录占用、源码恢复、准备命中判断、状态持久化和清理；executor 只消费准备好的仓库根和 Flutter package 根。

- Worker 拥有本机路径、Git、工具链探测、磁盘和进程操作。
- Protocol 仅增加可观测字段、枚举与必要配置契约。
- Cloud 负责接收、展示缓存决策和真实耗时，不替 Worker 访问磁盘或决定目录可复用性。
- 不新增 npm 依赖或跨包依赖方向，不把缓存逻辑放入 Core。

建议布局，所有目录都在 Worker root 内：

```text
runtime/slots/<slotId>/
  slot.lock
  workspaces/<workspaceKey>/
    checkout/                  # 位置固定，保留允许的构建生成物
    state.json                 # 输入身份、状态、owner、上次使用时间
    prepared.json              # 准备结果与受管理输出清单
  spool/<attemptId>/
    job.json
    process.json
    commands.log
    workspace.json             # 本次缓存决策、版本与身份引用
    runs/
    bundle/
    worker-timeline.jsonl
```

第一期每 slot 使用独立可写工作区。不同 slot 不共享 Pods、build、.dart_tool 或 node_modules；扫描器继续使用独立临时 checkout，避免扫描时的只读 chmod 和符号链接清理破坏执行环境。后续若实现 host 级 Git object mirror，它只能承担源码对象缓存，不能成为共享可写构建目录。

这是对现有 `spool/<attemptId>/checkout` 的替换设计：旧 spool 保留为历史证据，不自动成为缓存候选；禁用缓存仍通过同一准备模块创建全新工作区，不维持两套 executor 实现。

## 5. 缓存身份与失效条件

### 5.1 第一期的保守身份

`workspaceKey = SHA-256(schemaVersion + sourceIdentity + toolchainIdentity + preparationIdentity + launchIdentity)`。

使用稳定序列化；有序参数保留原顺序。hash 是身份校验，不是权限控制；缓存命中仍要求 slot 所有权和完整性验证。

| 身份 | 包含内容 |
| --- | --- |
| sourceIdentity | Cloud 实例命名空间、项目 ID、repository 身份、固定 commit、projectPath、入口解析后的 package 相对路径、子模块版本（如果支持） |
| toolchainIdentity | Flutter 实际路径与 framework/engine revision、Dart 版本、Xcode/selected developer directory、SDK 版本、CocoaPods、Node/包管理器版本、host 架构、目标平台/架构、simulator 与 physical device 类型 |
| preparationIdentity | 有序 install 命令、显式 preparation revision、声明的仓库外输入内容摘要、参与准备的环境值身份、准备模块版本 |
| launchIdentity | entry、debug/profile 模式、全部 flutterArgs、flavor、dart-define、dart-define-from-file 内容、构建相关环境身份 |

第一期包含完整 commit：即使只改测试文件，也先冷准备。这是缩小正确性范围的取舍；跨提交复用属于后续阶段。

suite、case selection、运行 ID 不属于构建身份。scenario 默认只改变运行状态，故不直接进入 key；如果其选择实际改变编译参数或准备环境，按实际构建输入进入身份。

### 5.2 仓库外输入和自定义命令

当前项目安装命令读取本机 bundle 和准备 bridge 的脚本，不能只 hash 命令字符串或路径。

第一期增加 Worker 本地的项目准备配方，按项目 ID 和当前命令清单精确匹配，至少声明：

- 配方 revision、可缓存的准备步骤、这些步骤的受管理输出。
- 脚本、bundle manifest、所有引用 tarball 的内容；tarball 仍逐个校验声明的 sha256。
- 脚本复制或生成所依赖的本机 Dart bridge 源目录；其输入摘要包括相对路径、文件内容和链接目标，不只检查 mtime。
- 其他 `file:` / `path:` 依赖、codegen 输入、构建环境变量及配置文件。

输入不完整、无法解析、动态读取网络且没有固定版本的命令，不跳过执行；第一期该配方直接走 cold，明确记录原因。不要按程序名猜测命令可缓存，也不自动解析任意 shell 脚本来推断传递依赖。

提供项目级手动失效 revision，用于管理员明确外部输入变化。它补充内容指纹，不能代替可识别文件的内容校验。环境中的秘密值不落盘或上传明文；需要参与身份时使用本机私有 key 的 HMAC，仅保存最终摘要。

### 5.3 准备结果

prepared manifest 记录实际依赖解析结果、被准备脚本修改的 tracked 文件、受管理生成物和工具链身份。Node 安装器当前不使用冻结的 lockfile，存在非固定依赖解析；首次准备后冻结已解析结果作为该缓存项的身份，配方 revision、TTL 或显式刷新触发重装，不声称普通重新安装必然得到相同依赖树。

缓存的 freshness 和源码正确性分开处理：依赖自动刷新周期不得在运行中触发；刷新发生在独占准备阶段。

Node 安装器生成的 `.fliwright-packages-*` staging 内含本地 tarball 和安装记录，可能被依赖解析引用；它属于该准备步骤的受管理输出，不能因为是临时目录名就清除。`.dart_tool/package_config.json` 中的 path dependencies 同样必须在固定路径下保持可解析。

## 6. 第一期的执行过程

### 6.1 冷路径

1. 取得现有 slot.lock 和 Cloud lease；计算输入身份与工具链摘要。
2. 选定 Worker 自己拥有的固定路径；原子写入 `preparing` 状态及本次 owner。
3. clone/fetch/checkout 精确 commit，校验 HEAD、根目录与入口路径，沿用工作区内符号链接约束。
4. 执行全部准备步骤；Node 安装器仍只接受没有 node_modules 的环境，不取消现有保护。
5. 保存源码与准备后覆盖文件的期望摘要、依赖输出清单；运行 Flutter 正常启动流程。
6. 本次 app.started、debugPort 和 Bridge 健康验证成功后，产生可缓存候选结果。
7. 独立执行场景、测试、导出源码证据；报告写入本次 spool。
8. supervisor 确认本次进程组完全停止，验证源文件和关键依赖未被测试修改，再将候选标记为 `ready`。

测试断言失败不会自动使正确的构建失效；构建/连接未完成、工作区被修改、无法确认进程停止或执行中断则不 seal 为 ready。

### 6.2 热路径

1. 检查 ready 状态、schema、输入指纹、路径身份与上次进程退出证明；原子改为 `in_use` 并绑定本次 attempt。
2. 校验精确 SHA；校验 tracked 源文件和准备后覆盖文件的内容，清除上一任务产生的非受管理输出。
3. 复用允许保留的构建与依赖输出；验证后跳过已声明可缓存的准备步骤。
4. 内容相同的源码和生成文件不重复写入，避免仅因时间戳变化使 Flutter/Xcode 重新构建。
5. 正常执行 `flutter run --machine`，仍由 Flutter 判断增量编译是否必要，仍重新取得和验证本次 VM Service。
6. 后续测试、报告、进程终止和 seal 与 cold 完全相同。

不能每次 `git clean -xfd`，它会删除构建缓存；也不能保留任意 ignored 文件。保留范围按解析出的 Flutter packages、Pods、build、.dart_tool、Node 配方输出等精确管理。遇到未登记输出无法可靠清理、缓存结构异常或内容不一致时，淘汰本项并走 cold。

Git 元数据由源码准备模块管理，不属于测试临时文件；缓存清理不能误删 `.git` 或改变 remote/HEAD。完整性检查耗时单独计量；先确保内容验证正确，再优化摘要计算，不能只比较目录存在、文件大小或 mtime 来换取命中速度。

源码受安装脚本合法修改时，以上次准备产物摘要而非单纯 `git diff --quiet` 判断；不通过 `git reset --hard` 后再次原样改写所有文件来伪造 warm 路径。

### 6.3 状态与崩溃恢复

状态为 `preparing → ready → in_use → ready`，失败或中断进入 `dirty`；磁盘中不存在 ready manifest 的目录一律不可命中。

manifest 使用现有原子写 journal 方式。不要为了原子发布重命名已经编译过的 checkout，编译缓存可能包含绝对路径；发布的是 manifest 状态。

只有 supervisor 在 `stopOwnedProcesses` 核验完成后允许 seal。executor 的候选结果不能独自证明所有进程已经结束。租约丢失沿用现有锁保留和人工 recover 语义，不能自动删除 lock 或抢占其他进程。

## 7. 失败回退规则

- 校验失败且未启动 Flutter：丢弃缓存项，当前任务在同一独占锁内冷准备一次。
- 缓存准备/构建阶段发生可识别的本地损坏：停止并确认本次进程组退出后，至多冷重试一次。
- 已进入 tests.run，或出现断言失败、Bridge 协议不兼容、业务错误、凭据错误：按原错误结束，不用“冷重跑”隐藏问题。
- 取消、超时、lease lost：立即停止，不触发回退；全部步骤共享原始任务 deadline。
- 进程无法停止、设备清理失败：沿用 quarantine；不继续使用缓存或设备。
- 冷回退失败保留两次原因与耗时；warm 尝试不能覆盖冷失败，也不能消耗无限重试。

缓存禁用模式是全新环境执行的排障能力，与 warm 是同一模块内的执行策略，不引入旧实现兼容层。

## 8. 测试状态隔离和设备重置

第一期保持现有前后 resetCommands，集中验证构建收益。进程、VM 地址、Scenario、Mock 规则和测试产物都按 attempt 重新创建。

“复用构建”不等于复用登录状态。业务测试继续使用命名、组合的 TestScenario，并通过 `auth.seedLoggedIn` 设置 app-owned auth；不执行真实登录、不通过泛化 Riverpod override 代替认证协议。

默认设备重启并不保证数据为空。需要明确业务测试要求的是“场景初始化”还是“全新安装”：前者由 app-owned reset/Scenario 覆盖数据库、偏好、服务状态；后者需显式卸载/清数据，Keychain 等范围单独定义。不能承诺一次 simctl reboot 或 reinstall 清除了所有状态。

设备策略后续分为：

- `reboot`：保留当前默认语义。
- `keep-booted`：确认设备 Booted，终止本次拥有的 App，执行已验证的应用状态初始化；故障时按策略回到设备重启。

第二种策略必须独立验证，用全链路指标计算收益。当前任务前后各重启一次，仅去掉启动前重启可能只是把等待转移到上一任务清理。不得未经实测就取消后置清理；物理设备和自定义 reset 命令维持明确的本地配置语义。

## 9. 第二期：跨提交增量和预编译产物

### 9.1 跨提交增量

将“固定路径的构建环境身份”和“本次输入版本身份”拆开：兼容工具链/原生配置的提交可以在同一目录切换，Flutter/Xcode 决定增量；产物身份仍严格绑定当前输入，不能复用旧版本二进制。

步骤：停止旧进程 → 校验 owner → 清除上次非受管理文件 → checkout 新 SHA → 运行需要更新的准备步骤 → 恢复/更新期望源码清单 → 正常增量编译。

原生依赖、Podfile.lock、插件、工程文件、SDK 或不兼容准备输出变化时淘汰对应环境，使用 cold。monorepo 依赖闭包必须覆盖 path dependencies、assets、generated sources 和构建脚本；只有证明变化完全落在测试文件等非构建输入内，才允许 binary 命中，否则默认重新编译。

### 9.2 二进制命中

原型优先验证 `flutter run --machine --use-application-binary=<artifact>` 或当前 SDK 支持的等效路径，确认它确实跳过原生构建，并仍提供本次 app.started、debugPort、正确 isolate、Bridge 与停止控制。当前 SDK 源码支持 run 的 build 开关，但这不等于完整 binary 路径已经验收。

候选产物 key 包括完整 App 构建输入、工具链、平台/架构、flavor、全部编译参数和准备输入。debug App 必须包含正确 Bridge；release 不参与此 VM Service 执行路径。iOS simulator 首先验证；physical device 的签名、provisioning、UDID 约束以及 Android 安装/端口转发分别验收。

App bundle 按目录树保存和校验，包含相对路径、文件内容、权限及链接目标，不能只 hash 主 executable。只读发布，消费者不可在原地修改。若 Flutter devFS 会写入额外内容，必须使用对应输入生成且独占的运行副本，并将这部分也纳入版本验证。

不直接接入任意已启动的 App 或旧端口。若当前 Flutter SDK 的 binary machine 路径无法可靠获取 endpoint，保留 warm，另行设计 owned launch/attach adapter；不通过扫描全机日志或固定端口绕过所有权。

## 10. 可观测性与页面

第一期至少记录：cache mode、hit/miss reason、身份摘要、准备耗时、校验耗时、实际 install 执行情况、cold fallback 次数、app.launch、app.verify、完整领取到测试开始耗时。cache root、argv、环境原文及 VM URL 不进入 Cloud 结构事件。

扩展 Protocol 的有限枚举和结构化缓存决策事件，同时更新 WorkerTimelineStore 的验证/投影、web 展示和测试。更新节点不允许影响原有调度状态，也不修改测试时间轴。

`app.progress` 有可靠 id 和 finished 配对的事件可以记录子操作。文案仅用于人工诊断，不从英文 `message` 猜测阶段；未证明某 id 代表 Xcode 编译时，显示“Flutter 启动进度”。协议有并发/缺失时保持观测不完整，不拼造耗时。

页面可展示“复用构建缓存”“首次准备”“缓存失效，重新准备”，附有限原因；不把整个 app.launch 仍显示成无法解释的一根长条。颜色、状态和选中样式遵守 Cloud 主题规范。

## 11. 容量、清理和运维

新增 Worker 本地 `executionCache` 配置，建议首轮：`enabled=false`，`maxBytes=30 GiB/slot`，`maxEntries=3/slot`，`maxAgeDays=7`，`minFreeBytes=10 GiB/host`。这些是初始运营值，真实项目测量后调整；多 slot 汇总必须检查 host 余量。

只在无活动 reservation 的安全点清理，按最近使用时间淘汰；不删除本次 active、ready 待 seal 或恢复所需目录。ready 项可以淘汰，dirty 项确认无 owner 后优先清理。配额按实际生成物统计，磁盘压力无法缓解时在编译前明确失败，不反复 cold 重试写满磁盘。

提供本地 cache inspect/prune/invalidate 管理命令；不得删除用户源码、项目外 tarball、全局 pub/npm cache 或历史报告。已存在的历史 spool 保留策略独立处理，不用缓存 LRU 顺带删除证据。

manifest schema、工具链和配方变化自然失效。回滚到 cache disabled 时，新任务使用全新工作区；已运行任务仍按原租约和清理流程结束。

## 12. 与现有设计的关系

- 本方案依据当前 Git-only executor；不依赖尚未实现的[本地项目设计](./2026-10-23-cloud-local-projects-design.md)。若后者先落地，复用其源码准备 seam，避免再实现一个 ProjectWorkspace。
- 缓存只管理 worker-owned 目录，绝不将其 clean/chmod/符号链接清理应用到 developer-owned 本地项目。
- 沿用[Worker 时间轴设计](./2026-10-21-worker-execution-timeline-design.md)的真实观测、唯一 supervisor 时钟与租约身份，不把历史统计伪装成本次阶段。
- 框架、依赖方向和公开 Core 契约保持在现有治理范围内。稳定实现后再生成 docs/features；本次设计不更新“已实现”文档。
