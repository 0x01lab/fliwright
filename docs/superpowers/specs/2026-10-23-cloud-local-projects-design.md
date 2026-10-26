# Cloud 本地项目与 Git 项目统一设计

日期：2026-10-23。状态：建议方案，供评审与后续实施；本文不表示功能已实现。

## 1. 目标与范围

同一个 `@fliwright/cloud` 包支持本机部署和云端部署；同一个实例可以同时管理 Git 项目与 Worker 本地目录项目。部署位置不决定项目来源，不创建另一套 Local Cloud 产品或执行链路。

典型使用：Cloud 和 Worker 在同一台电脑，用户在网页添加目录、扫描 Fliwright 用例、选择 suite/case 与 scenario、排队运行并查看报告。Cloud 部署到云端时，相同流程通过目标电脑上的 Worker 完成。

第一版范围：

- 本地目录可以没有 Git，也可以包含未提交、未跟踪的源码。
- Web 添加目录、选择 Worker 已注册的目录、手动扫描、suite/case 执行。
- 本地项目复用已安装依赖和 Flutter 构建缓存，直接在工作目录执行。
- 每个本地工作区的扫描与运行互斥；运行使用现有独占设备槽位。
- 保留现有 Git 项目的固定 SHA 扫描、执行、GitLab Push 自动运行和报告能力。

不在第一版范围：源码上传和跨 Worker 分发、不可变本地源码快照、文件变化自动触发测试、任意目录树浏览器、启动/安装 Worker、复用开发者已经启动的 App 或 VM Service。Worker 仍启动并管理自己的 Flutter App；测试对业务环境的副作用沿用现有 scenario 约束。

## 2. 当前源码事实

以当前工作区源码为准，包含尚未提交的 Cloud/Worker 改动；2026-10-20 的设计文档只提供产品背景。

| 位置 | 已有能力 | 本次变化 |
| --- | --- | --- |
| `packages/fliwright-cli/src/catalog.ts` | Vitest collection、suite/case/scenario 与稳定 caseId | 复用，不另写文件名扫描器 |
| `packages/fliwright-cloud-worker/src/catalog-scanner.ts` | 独立扫描租约、Git checkout、隔离 collection 子进程 | 从源码准备模块取得工作目录 |
| `packages/fliwright-cloud-worker/src/executor.ts` | Git checkout、安装、Flutter 启动、精确用例执行、报告 | 从源码准备模块取得工作目录 |
| `packages/fliwright-cloud/src/CloudStore.ts` | 项目、目录、队列、租约、设备授权与请求快照 | 增加本地目录登记、来源匹配、工作区互斥 |
| `packages/fliwright-cloud/src/server.ts` | 项目管理、扫描、请求、Worker 控制面 | 来源感知的校验与本地登记接口 |
| `packages/fliwright-cloud-protocol/src/contracts.ts` | Project/Catalog/Request 都依赖 Git 字段与 SHA | 明确项目来源、扫描选择和已解析源码版本 |
| `packages/fliwright-cloud/src/web/Projects.tsx` | Git 项目表单、目录浏览、suite/case 提交 | 本地来源表单和来源感知的版本显示 |

当前 SQLite `user_version=8`。扫描和执行均执行 clone/fetch/checkout；扫描以 40 位零 SHA 表示待解析分支。当前调度依据设备授权的项目 ID，没有本地目录归属条件。

特别注意：`secureCatalogCheckout` 会删除部分符号链接，扫描还会 chmod 为只读；`installLocalPackages` 会在 checkout 写入依赖。它们只适用于 Worker 自己拥有的临时目录，不能应用到开发者工作区。

## 3. 部署与职责

| Cloud 位置 | 项目来源 | 扫描和执行位置 |
| --- | --- | --- |
| 本机 | Git | 有权限且满足设备能力的 Worker |
| 本机 | 本地目录 | 该目录绑定的 Worker，常见为同机唯一 Worker |
| 云端 | Git | 有权限且满足设备能力的 Worker |
| 云端 | 本地目录 | 该目录绑定的远端 Worker，通过现有主动连接控制面通信 |

Cloud 负责项目配置、登记作业、目录元数据、队列、租约和报告；Worker 负责目录访问、登记持久化、路径校验、版本指纹、进程与设备操作。Protocol 只放 wire schema，不放文件系统代码。

不通过 `localUser`、URL 是 localhost、IP 相同等条件推断文件系统共享；这些信息也不改变目录权限。同机部署自动选中唯一可用 Worker，仍通过相同接口执行。云端无需访问开发电脑的文件系统，也不要求向开发电脑开放入站端口。

## 4. 领域模型

### 4.1 ProjectSource：代码从哪里取得

```ts
type ProjectSource =
  | {
      kind: 'git';
      repository: string;
      defaultBranch: string;
      repositoryCredentialRef: string | null;
    }
  | {
      kind: 'local';
      workerId: string;
      bindingId: string;
      bindingGeneration: number;
    };
```

`Project` 保留 id/name/configRevision、相对 `projectPath`、Flutter entry/args、suite/scenario、能力要求、安装命令与超时。`projectPath` 相对于 Git checkout 根或本地登记工作区根，支持 monorepo。

Git 专属的 Webhook、凭据与自动运行配置仅对 Git 来源有效；本地来源提交这些配置时返回明确的 400，不静默忽略。本地项目不填写假 repository、假 branch 或假 SHA。第一版不允许原地切换来源种类；新建项目完成切换，避免历史与授权混用。

### 4.2 LocalWorkspaceBinding：Worker 对本地目录的登记

Worker 持久化一份本地 registry，至少保存：

- `bindingId`：登记生成的 UUID，不使用绝对路径充当 ID。
- `generation`：登记位置或身份被替换时的版本；不能只改路径而继续匹配旧任务。
- `canonicalRoot`：经过 realpath 的工作区根。
- `directoryIdentity`：根目录的设备/inode 等身份，重新检查时识别原路径被替换。
- `name`、启用状态、创建时间与对应 Cloud/Worker 身份。

目录根需要包含希望校验的本地源码依赖；同一 monorepo 内的多个 Flutter 项目共享同一个 binding，通过 `projectPath` 区分。Worker 拒绝同一 registry 中重叠的不同工作区根，避免嵌套目录绕过互斥。

Cloud 保存 Worker 上报的只读登记投影：bindingId、generation、名称、展示路径、可用性、服务端接收时间和错误码。执行时仍以 Worker registry 为权威；请求不能覆盖 canonicalRoot。

路径移动需要重新登记并显式重新绑定项目；增加 configRevision，原目录与旧 Catalog 不会自动变成新目录。registry 丢失后不能按同名自动重建旧 bindingId；撤销 Worker 后旧目录立即不可用。重新配对同一 Worker ID 可保留本机 registry，但必须通过新有效凭据重新上报。

### 4.3 SourceRevision：这次扫描/执行针对什么版本

```ts
type SourceRevision =
  | { kind: 'git'; commit: string }
  | {
      kind: 'local';
      workerId: string;
      bindingId: string;
      bindingGeneration: number;
      fingerprintVersion: 'local-inputs-v1';
      fingerprint: string; // SHA-256，64 位十六进制
    };
```

`TestCatalog` 和排队请求保存 `sourceRevision`；请求还冻结 Project 的运行配置与精确选择。`sourceRevision` 与现有的触发来源 `source.kind=manual/push` 是不同概念，不复用字段。

Git 分支或 SHA 是扫描选择 `ScanSelector`，不是尚未解析的 SourceRevision：

```ts
type ScanSelector =
  | { kind: 'git-commit'; commit: string }
  | { kind: 'git-branch'; branch: string }
  | { kind: 'local-current' };
```

排队扫描保存 selector 与项目配置快照；Worker 扫描成功后才保存 resolvedRevision。移除新链路中零 SHA 占位的约定。

本地提交必须引用 Catalog；版本由服务端从 Catalog 取得，浏览器不能指定另一个目录或 fingerprint。套件级提交也遵守这个条件。CLI 的 Git 直提能力继续校验真实 SHA，并转入同一内部请求模型。

## 5. 添加本地项目

### 5.1 Worker 配置

增加可选的 `localProjects` 配置，默认不授权 Web 注册任意路径：

```json
{
  "localProjects": {
    "allowedRoots": ["/Users/example/projects"],
    "registryPath": "./local-projects.json"
  }
}
```

相对 registryPath 归属 Worker 配置目录，host 与各 slot 共用同一 registry。allowedRoots 在 Worker 侧配置并 realpath 校验，不能由 Cloud 任务临时扩权。

提供 `fliwright-worker projects add <config.json> <absolute-workspace-path> --name <name>` 和 `projects list/remove`。这些是本地管理员操作，可精确登记单个目录，不要求放开整个父目录。registry 原子写入并串行化修改；命令变更在下一次上报被运行中的 host 读取。

已有 `install-local-packages` 是依赖包安装工具，与这里的“本地项目登记”不同，不复用名称或实现。

### 5.2 Web 添加

1. Admin 在“创建项目”选择“本地目录”。
2. 页面列出支持本地项目的 Worker；只有一个可用 Worker 时自动选择并显示其名称。
3. 选择已登记目录，或输入该 Worker 上的绝对目录。输入框明确写“Worker 所在电脑的路径”；没有注册权限时展示本机登记命令。
4. 输入新目录时，Cloud 创建有持久状态的登记作业，由该 Worker 领取、校验、持久化并返回 binding。没有有效结果前不创建可运行 Project。
5. 选择相对 projectPath，Cloud 创建 local Project，再触发一次扫描；Worker 在扫描准备时检查 pubspec、Fliwright 配置、依赖与测试配置，扫描成功前项目不显示就绪。
6. 在既有设备页面允许设备运行该项目。目录登记不等于设备授权，不自动扩大现有设备的 targets。

浏览器目录选择 API 不能把服务器/Worker 本地目录授权给后台 Node 进程，因此第一版采用路径输入与已登记列表。Cloud 不直接 readdir，不实现整盘浏览。

### 5.3 登记作业语义

- durable job：queued/running/succeeded/failed/cancelled，固定 workerId、路径与提交人，5 分钟总截止时间。
- Idempotency-Key 合并重复提交；Worker 还按 canonicalRoot 去重，相同目录的不同路径别名返回同一 binding。
- Worker claim 生成 token，30 秒租期、5 秒心跳；结果需要当前身份、作业 token 和未过期租约。
- 登记先写本地 registry，再回传 Cloud。响应丢失后重试返回同一 binding；Cloud 重启不丢作业。
- 过期/cancelled 作业不接受迟到结果，不自动创建 Project；本地已经登记的目录可在后续 inventory 中再次选择。
- 删除 Project 不删除真实目录或 registry；移除 binding 时先阻止关联项目新任务，活动扫描/执行未结束时拒绝移除。

## 6. 统一的源码准备模块

在 Worker 中新增 `ProjectWorkspace` module，把现有扫描器和执行器中分散的源码准备逻辑收敛到一个 seam。Git 和 Local 是两个实际需要的 adapter；调用方不再自己分支 clone/path/chmod。

建议的内部 interface：

```ts
interface WorkspaceReservation {
  descriptor: WorkspaceReservationDescriptor; // 可传入 owned 子进程，无 Cloud 凭据
  release(): Promise<void>;
}

interface PreparedWorkspace {
  projectDir: string;
  revision: SourceRevision;
  ownership: 'worker-owned' | 'user-owned';
  verifyUnchanged(signal: AbortSignal): Promise<boolean>;
  release(): Promise<void>;
}

interface ProjectWorkspace {
  reserve(input: {
    project: ProjectExecutionSnapshot;
    owner: WorkspaceOwner;
    signal: AbortSignal;
  }): Promise<WorkspaceReservation>;
  prepare(input: {
    project: ProjectExecutionSnapshot;
    reservation: WorkspaceReservationDescriptor;
    purpose: 'catalog' | 'execution';
    selector?: ScanSelector;
    expectedRevision?: SourceRevision;
    attemptDir: string;
    signal: AbortSignal;
  }): Promise<PreparedWorkspace>;
}
```

实现内部可以注入受控命令运行器与 registry 以便测试；不把 Git 命令、chmod、清理路径等细节传给调用方。WorkspaceOwner 含作业 ID、controller 进程身份与恢复日志位置；descriptor 只描述已保留的目录资源，不包含完整 registry 或主机凭据。

reserve 在 supervisor/scanner controller 中执行，Local 取得持久锁、Git 返回无本地锁的 reservation。prepare 在受管子进程中执行；Local 验证 reservation 后使用目录，Git 继续在该子进程中 clone/安装，避免主机凭据与无监督安装混入 controller。prepare 失败必须清理自己创建的临时资源；PreparedWorkspace.release 不释放 controller 的持久锁。controller 必须先确认 owned 进程组结束，再释放 reservation；不能把 executor finally 当成进程树已清理的证明。

**Git adapter：**继续建立 Worker-owned checkout、固定 commit、安装依赖、处理符号链接；catalog 模式在收集前设为只读。release 只删除它自己创建的目录。

**Local adapter：**reserve 从 registry 解析绑定、验证代次与根目录身份并取得工作区锁；prepare 再次校验身份和 reservation、检查依赖、计算指纹并核对 expectedRevision，返回现有工作目录。不 clone、不 chmod、不删除符号链接、不执行 `git reset/clean`。所有报告、日志和任务状态仍写入 attemptDir。

Local 默认不执行 Project.install。第一版的本地来源要求 install 为空，依赖由用户在本机提前安装；页面提供明确缺项提示。Git 保持现有安装命令行为。后续若支持本地安装，需作为显式操作单独设计，不能继承 Git 的安装语义。

collection 使用现有子进程、最小环境、超时、取消和输出上限，不注入 Worker token 或设备端点。collection 仍可能执行模块顶层代码；Local 是受信工作区执行，无法对用户目录承诺只读或 OS sandbox。不能为了“隔离”而改写原目录权限。导入副作用由本地项目作者负责，扫描前后版本核验可发现受管输入变动。

## 7. 本地工作目录的版本语义

### 7.1 指纹范围

`local-inputs-v1` 对登记工作区根下的规则内输入按稳定相对路径排序，哈希路径、文件内容、文件类型与可执行位。覆盖未提交/未跟踪文件，不依赖 Git HEAD 或 git status。

规则包括 Dart/TS 等源码、测试、平台工程、资产、pubspec/package/workspace 清单与 lockfile、Fliwright/Vitest/构建配置，以及未被排除的其他普通文件。第一版采用“全部文件减固定工具输出目录”的规则，不直接套用 `.gitignore`，避免漏掉被忽略但测试使用的文件。

固定排除 `.git`、`node_modules`、`.dart_tool`、`build`、`.fliwright` 下的运行/锁/报告输出，以及已识别的工具缓存输出；`.fliwright/tests`、mocks、scenario/config 等输入必须保留。排除规则随 fingerprintVersion 版本化，不能忽略整个 `.fliwright`。

遍历设置数量、总字节与单文件上限，采用流式哈希；超过上限返回可操作的失败，不静默漏文件。建议初始上限 100,000 文件、4 GiB 总输入、512 MiB 单文件，后续根据真实项目测量调整。限制与 fingerprintVersion/配置变化必须进入目录过期判断。

源码内部链接检查实际目标是否仍在登记根内，内部链接记录链接和目标身份/内容；越界源码链接返回错误。被排除的 node_modules/cache 链接不修改、不遍历。本地源码依赖应包含在登记根内；Node/Pub 外部包与 Flutter SDK 属于执行环境，指纹不保证其内容或环境变量不变。报告记录工具版本与 lockfile 摘要，不能称为全环境快照。

### 7.2 扫描

1. 取得工作区独占锁，读取初始指纹。
2. 执行 collection，得到完整目录、scenario 指纹。
3. 再次计算指纹；不同则返回 `workspace_changed_during_scan`，保留旧目录，不发布新 ready Catalog。
4. 相同时将该 SourceRevision 与 Catalog 一起返回并释放锁。

### 7.3 执行

1. Cloud 将已选 Catalog 的 SourceRevision 冻结到请求，并限制 owner Worker。
2. Worker 取得工作区锁，在设备 reset 和 Flutter 启动前校验登记代次与指纹。
3. 不匹配则以 `local_source_changed` 或 `local_binding_changed` 终止准备，不运行旧选择，不自动换成当前目录版本。
4. App 启动后、测试开始前再校验一次，覆盖构建/依赖解析改写输入文件的情况。
5. 收集测试结果与源码证据后，再计算结束指纹，记录 `unchanged/changed/unknown`。changed 展示“执行期间工作目录发生变化”，unknown 表示中断或校验未完成；保留实际测试 verdict。源码证据若在变化期间读取也可能与实际执行输入不同，需要沿用同一提示。

版本观察进入 attempt 的持久结果，准备失败或没有 report bundle 也可查询。正常报告在 manifest/上传摘要计算前附加版本元数据，并同步更新导出格式、发布校验与读取逻辑；不能在发布后修改 bundle。已有旧报告缺少该元数据时显示“未记录”，不从当前目录补算历史事实。

工作区锁只协调 Fliwright 的作业，不能阻止编辑器或用户终端写文件。前后哈希也检测不到所有“修改后又恢复”的过程，因此第一版明确显示“工作目录运行”，不能承诺固定源码复现。编辑可能导致构建/测试读取混合版本；需要此保证的用户继续使用 Git 固定 commit，后续再提供本地快照模式。

### 7.4 目录过期与重跑

- 目录新扫描不覆盖旧 Catalog，保留现有不可变目录与请求引用关系。
- 页面展示扫描时间和最后已知状态；未做实时监听时不声称目录实时最新。
- 指纹不匹配时提示“目录已变化，请重新扫描”，新扫描后用户重新提交。
- 本地历史任务重跑继续引用原指纹，只在当前输入匹配时运行；不能把“重跑原版本”悄悄变成“运行最新目录”。
- Git 历史任务仍从原 SHA 获取源码。

## 8. 调度、互斥与恢复

### 8.1 Cloud 调度条件

本地扫描和执行必须满足以下来源条件；执行还需要既有设备授权、能力与 slot ready 条件，扫描不依赖设备槽位：

- 当前 Worker 等于 ProjectSource.workerId。
- 已上报对应 bindingId/generation，状态 available，投影未过期。
- Worker 已声明支持当前 wire protocol 与 local-inputs-v1。
- 没有同一 binding 的活动扫描或执行租约。

Admin 创建的 Local Project 对 owner Worker 授予该绑定的扫描资格，不要求先绑定设备，也不扩大其他目录的访问权。Git 扫描继续使用既有 catalogProjects/项目授权规则。

Cloud 在同一个 SQLite transaction 中领取设备槽位/扫描租约与工作区租约，键为 `(workerId, bindingId)`。同一 binding 下多个 projectPath 共享互斥；不同 binding 可在不同设备并行。Git 不新增项目级互斥。

扫描与运行争用工作区时只排队，不占设备等锁。两条队列均从最早可执行项领取；同一 binding 按入队时间决定优先级，避免扫描持续抢占运行。资源忙时跳过该项目继续查找其他可运行任务，不阻塞全局 FIFO。

### 8.2 Worker 本地锁

Cloud 租约处理在线调度；本机持久锁处理重启、分区和多个 Worker 进程。锁位于登记工作区的 `.fliwright/cloud/local-workspace.lock`，通过排他创建取得，记录持有 token、扫描/attempt ID、进程身份和阶段。相同 canonicalRoot 的路径别名使用同一锁。

锁目录和文件拒绝符号链接，registry 校验后再定位；释放时比对 owner token，不能删除别人的锁。运行锁由 supervisor 持有，collection 锁由 scanner controller 持有；executor 子进程退出不立即释放，先确认所有 owned process group 已终止。

正常完成：结束版本观察、终止 owned processes、释放工作区锁，最后随扫描结果或 execution finish 完成中心工作区租约。第一版中心工作区租约保守持有到 finish，不另增提前释放接口；reset-after 和报告上传可能延长互斥时间，但沿用既有 slot 生命周期。清理失败/所有权丢失：锁保留为 needs-recovery，不能靠 TTL 自动删锁。

本机锁冲突是准备错误，不得覆盖锁或启动设备操作；上报 workspace_needs_recovery/busy 状态并触发投影刷新，中心队列显示阻塞，防止其他 slot 持续领取同一工作区的任务。执行结果需要支持 prepared reservation 的释放钩子，由 WorkerAgent 在 owned 进程结束后调用，现有 slot 锁不能替代该资源锁。

新增本机 `projects recover <config.json> <binding-id>`，在确认原 supervisor 已退出、原 owned process groups 已终止后清除残留锁。执行作业同时涉及设备恢复时沿用现有 slot recover；Cloud 扫描租约过期本身不证明本机进程已经停止。

### 8.3 离线与错误

binding inventory 默认每 30 秒全量上报，连接/registry 变更立即重报；90 秒未收到新投影标记 stale。使用服务端接收时间，不能用 Worker 时钟判断。

Worker 离线时本地项目显示所属主机离线，历史 Catalog/报告仍可读；提交可入队，但返回并展示阻塞原因，不把任务分配到别的 Worker。目录删除、依赖缺失、登记代次改变、指纹改变分别提供结构化错误码。

准备失败沿用 `infrastructure_failed`，verdict unknown，不新增重复的任务状态机；期望失效等错误标记 permanent，避免无休止自动重试。部分设备操作发生后仍执行既有 cleanup/reset 流程，不能仅因“准备阶段”就跳过已经取得资源的清理。

## 9. 接口与存储

### 9.1 新增接口

| 接口 | 权限/调用方 | 职责 |
| --- | --- | --- |
| `GET /api/workers/:id/local-workspaces` | admin | 读取已登记目录与可用性，不遍历目录 |
| `POST /api/local-workspace-registrations` | admin | 创建目标 Worker 上的目录登记作业 |
| `GET /api/local-workspace-registrations/:id` | admin | 查询登记结果 |
| `POST /api/local-workspace-registrations/:id/cancel` | admin | 取消尚未完成的登记 |
| `/api/worker/local-workspaces` | Worker | 全量上报 registry 投影与本地能力 |
| `/api/worker/local-workspaces/registrations/{claim,heartbeat,result,failure}` | Worker | 处理属于自己的登记作业 |

Worker 操作加入现有 `workerOperationSchema` allowlist；保持现有 HTTP/WS 双入口对同一 handler 的复用，不引入 Server 主动调用 Worker 的 RPC 或第三套通道。claim/result 保留租约 token 与 Worker 身份校验。

现有 `/api/projects`、`/scans`、`/catalogs`、`/requests` 路由升级为来源感知；Local scan 只接受 local-current，拒绝 Git selector。Git repositoryHosts/凭据校验保留。目录展示路径仅在 admin 接口返回，普通项目 DTO 只显示工作区名称与 Worker。

所有新增 schema strict，限制登记路径长度、job 数量、registry 项数和结果大小；建议路径上限 4096 字符、每 Worker 100 个 binding、每 Worker 10 个未结束登记作业。沿用 team role、CSRF 与 Worker credential 撤销机制。

### 9.2 SQLite 迁移

在实施时分配下一个实际可用版本；按当前源码为 v8 → v9，事务内完成：

- 新增 `worker_local_workspaces`：worker/binding/generation、展示元数据、available/receivedAt。
- 新增 `local_workspace_registrations`：目标身份、状态、输入、租约与结果；过期结果不可覆盖。
- 新增 `workspace_leases`：binding、owner kind/id、token 摘要、租期，与领取事务联合更新。
- Project JSON 转为 source 判别联合；原 Git 字段移入 git source。
- Catalog/Request/Attempt/scan job 内的 Git commit 转为 SourceRevision；待解析分支转为 ScanSelector。
- 重建 catalogs/catalog_scans 的通用版本列，移除强制非空 commit_sha；branch_heads 保持 Git 专属。
- 保留 ID、队列顺序、slot generation、原配置快照、结果、分享与 report bundle 关联。
- 保留已有幂等记录的 fingerprint，升级前的 payload 与身份是历史审计事实，不能迁移时重新发任务。

迁移只修改数据库中的业务记录，不重写已发布报告的 run.json/源文件/manifest 摘要。旧报告仍按报告格式读取；网页任务版本由迁移后的请求元数据提供。备份包含本地项目描述，恢复到另一台电脑时 binding 应显示 unavailable，不能把备份中的路径自动注册到新 Worker。

本次涉及 wire contract 调整，Cloud 与 Worker 配套升级，明确声明 protocolVersion=2 与能力；升级旧 Worker 之前不领取新版本任务。升级流程停止接单、排空活动扫描/执行、备份 DB、升级 Cloud/Worker，再恢复；不新增长期双协议分支。若数据库有未结束的租约则先完成既有恢复流程，不直接迁移正在运行的 executor。

## 10. 页面与报告

项目创建表单：来源选项“Git 仓库 / 本地目录”。Local 展示 Worker、目录登记/选择、projectPath、Flutter 入口、suite；隐藏 Git branch/Webhook/凭据/自动运行设置。

项目详情保留概览、测试用例、运行记录、设置：

- Local 概览显示工作区名称、Worker 在线状态、依赖缺项、最近扫描和“工作目录运行”说明。
- 目录选择由 commit 改为 catalogId；同 commit 的不同扫描也不能混成同一选项。
- Git 显示短 SHA，Local 显示扫描时间、短指纹与 configRevision；管理员可查看目录路径。
- 测试用例操作继续使用 suite/case、scenario，不让用户输入任意 selector、命令或路径。
- 版本失配提供重新扫描入口；Worker 离线/设备未授权/工作区忙是独立状态。
- 运行记录、全局队列、TestBoard、任务详情统一使用版本格式化 helper，不再无条件读取 input.commit.slice。
- Worker 执行时间线增加 `workspace.prepare` 及 resolve_local/verify_local 操作；Git 保留 repository.checkout 历史语义与显示。
- 报告记录 expectedRevision、开始/结束观测与 sourceConsistency；changed/unknown 的提示独立于测试 verdict。

状态使用文案、图标和 subtle fills；遵守现有 Cloud 视觉规则，不增加状态边条或装饰描边。

## 11. 验收与验证

必须通过以下可观察场景，才算第一版完成：

1. 同机 Cloud + Worker：网页登记目录，扫描无 VM Service 获取 suite/case/scenario，运行一个 case，只执行所选 case，报告可回放。
2. 云端 Cloud + 远端 Worker：Cloud 不接触本地文件，完成相同流程；另一 Worker 即使获得项目设备授权也不能领取其本地任务。
3. 一个实例同时有 Git 与 Local：Git 手动运行和 Push 自动运行不受 Local 互斥影响；非 Git/dirty 项目可以运行。
4. 修改未提交测试或 Dart 源码后，旧目录提交在设备操作前被拒绝执行；重新扫描可正常提交，不伪造 SHA。
5. 扫描过程中改文件导致扫描失败且保留旧目录；测试执行期间改文件，报告保留 verdict 并明确 changed/unknown。
6. 同一 binding 的扫描、两个 projectPath、多个设备任务串行；不同 binding 可并行；路径别名不会绕过本机锁。
7. 扫描取消、执行取消、断网、Cloud/Worker 重启、租约过期和迟到回传都遵守 fencing；残留本机锁需要验证后恢复。
8. 不发生原目录 chmod、删链接、git reset/clean 或递归删除；Flutter/Vitest 的正常构建缓存写入有明确说明，报告与日志位于 Worker runtime。
9. 未授权目录、源码越界链接、目录身份被替换、恶意路径、错误 Worker 上报、被撤销凭据和超限 payload 被拒绝。
10. v8 DB 升级后旧 Git 项目、排队任务、历史结果、分享、幂等记录均保持；新 DB 与备份异机恢复也覆盖。

测试按模块和 wire seam 编写：真实临时目录测试 registry/指纹/锁、真实临时 Git 仓库测试 Git adapter、SQLite 与 HTTP/WS 集成测试调度/迁移/权限、现有 UI 测试框架验证来源表单。collection 测试复用真实 Vitest collector，证明不会执行 test/hook body。

真实 Flutter 验证单列：一台专用设备，包含同机与远端控制面两种部署场景；未完成真实设备链路时不能用单测结果代替 E2E 验收。

## 12. 决策与后续演进

- 保留单一 Cloud 产品与部署包，项目来源独立于部署位置。
- Worker 是本地目录访问者；Cloud 中的路径输入只是登记请求，不能成为执行器的任意 cwd。
- 第一版采用工作目录运行，提高依赖/缓存复用与落地速度；明确其版本观察与复现能力的限制。
- 源码准备复杂度集中在 ProjectWorkspace module，避免 scanner/executor 各复制一套 Git/Local 分支。
- 本地快照作为后续可选执行模式，需要重新设计 node_modules、Pub path dependencies、平台工程和构建缓存的准备规则；不把“复制目录”误认为已经解决可复现性。
- 文件监听、自动重扫、local watch 自动执行在手动链路稳定后再做，不与 GitLab Push 策略混用。

实施拆解见 [执行计划](../plans/2026-10-23-cloud-local-projects.md)。
