# Fliwright Cloud 项目、测试目录与自动运行设计

日期：2026-10-20。状态：已实现；2026-10-27 更新运行场景可选契约。

## 1. 目标

把 Cloud 从管理员手写 ApplicationTarget JSON 的配置模型，扩展为以项目为中心的工作流：绑定受信 Git 仓库、发现并浏览 Fliwright 测试、手动选择提交运行，以及按策略自动测试最新提交。测试仍由专用 Worker 在固定 commit 和独占设备槽位上执行，Cloud Server 只负责项目、策略、队列、权限和报告。

用户可以：

- 创建项目，绑定 Git 仓库与默认分支，配置 Flutter 入口和安装步骤。
- 触发仓库扫描，查看指定 commit 中的测试文件、测试名称和场景，并看到目录是否过期。
- 从项目页运行一个 suite/场景组合，或运行一个精确测试用例。
- 开启默认分支自动运行策略，让新提交触发策略选中的 suite/场景。
- 从任务详情追溯来源 commit、测试选择、项目配置版本、扫描目录版本和报告。

不在本设计范围：多租户 SaaS、任意仓库上传、自然语言生成测试、从 Cloud 编辑仓库文件、自动重试业务断言失败、自动中断正在运行的旧 commit 测试。

## 2026-10-27 运行场景可选契约

- 项目场景列表默认为空，scenario 不再是项目就绪或测试提交的前置条件。
- 手动运行默认「直接运行（无场景）」。提交省略 scenario，Worker 显式关闭仓库和环境中的 defaultScenario，不自动加载 Mock 规则；测试代码自己的准备逻辑照常执行。
- 显式选择命名场景时仍需匹配所选 Catalog，避免运行旧配置中的场景。
- 自动运行可只选择 suite；无场景的自动任务沿用固定 SHA、幂等和旧任务替代规则。
- 以下历史设计中要求 suite/scenario 组合的描述，以本节为准。

## 2. 当前基础与缺口

当前 `ApplicationTarget` 已保存仓库、项目目录、Flutter 入口、suite 到测试文件的映射、scenario、安装命令和运行能力。Worker 已从仓库拉取指定 SHA、检出固定提交并执行目标测试。Cloud 已有固定 commit 的任务、目标配置快照、FIFO 队列、设备租约和报告。

当前配置在管理员 JSON 编辑器中；测试提交页要求手输 40 位 SHA；没有仓库扫描或用例目录；自动运行也没有项目策略或仓库事件入口。现有 CLI `run` 必须解析项目配置并取得活 VM Service，因此不能直接用于浏览用例。

## 3. 产品模型

### Project

Project 是用户可见的仓库与测试配置实体。第一阶段可由当前 `ApplicationTarget` 演进，不在 Web/API 中继续称为 target；内部迁移应把配置与运行设置收敛到 Project，而执行槽位仍通过项目 ID 授权。

Project 字段：

- `id`, `name`, `repository`, `defaultBranch`, `projectPath`。
- `entry`, `install`, `flutterArgs`, `requiredCapabilities`, `timeoutMs`。
- `suites`: 稳定 suite ID 到仓库相对测试路径/glob 的映射。
- `scenarios`: 项目中允许的命名 scenario。
- `configRevision`: 每次配置变更单调递增。
- 仓库凭据引用、Webhook secret 摘要、Webhook 状态；秘密本身不进入 SQLite 或报告。
- `autoRun`: enabled、branch、suite/scenario 选择和策略版本。

Project 配置由 admin 编辑；operator 可以请求扫描和手动运行；member 可查看目录并提交允许的手动任务。危险的 `install` 命令仍仅 admin 可改，所有运行命令来自项目配置，不接受任务提交者覆写。

### TestCatalog

Catalog 是某个 Project 在一个确切 commit 和 `configRevision` 下的不可变发现结果：

- `catalogId`, `projectId`, `commit`, `configRevision`, `createdAt`, `status`, `errorSummary`。
- 场景名称及其解析后的稳定 fingerprint，不保存场景中的秘密值。
- Suite 列表、仓库相对文件、用例 title path、每个用例的稳定 `caseId`。
- 扫描器与 Fliwright/Vitest 版本，便于解释目录差异。

`caseId` 由相对文件路径、完整 title path 和同名重复序号构成，并只在同 commit 的 Catalog 中解释。执行任务引用 `catalogId` 与 `caseId`，服务端从 Catalog 解析出路径和精确选择器；客户端不能传任意路径、正则或 shell 命令。Catalog 保留最近若干版本以及所有被任务引用的版本。

测试是动态注册时，目录记录实际收集到的结果。收集失败或仓库不符合规则时展示错误，不猜测或静默降级为“没有测试”。

### TestRequest

一次请求仍对应一个固定 commit 上的执行，继续保存来源、执行 attempt、设备租约、结果和报告。新增字段：

- `projectId`、`configRevision`、`catalogId`。
- 选择模式：`suite` 或 `case`，以及 suite/scenario 或 caseId。
- 来源：`manual` 或 `push`、branch、commit、Webhook delivery ID 或提交人。
- `autoPolicyRevision`（自动任务）和可选 `supersededBy`。

提交时冻结项目配置与选择结果。后续配置编辑、目录刷新或分支前进均不改变已排队请求。

## 4. 项目接入与扫描

1. Admin 创建 Project，填写 clone URL、默认分支、Flutter 入口和项目目录；选择 Worker 仓库凭据引用。Cloud 验证地址格式和项目唯一性，但不在 Server 上 clone 或执行仓库代码。
2. Cloud 发出 `catalog_scan` 工作项。Worker 在独立临时目录中以只读凭据解析默认分支 HEAD，固定该 SHA，clone/fetch 后安装受控依赖并扫描。
3. 扫描器读取 Fliwright 配置中的 suites/scenarios，并通过 Vitest collection 发现测试 title path。它不得启动 Flutter、连接 VM Service、调用设备 reset 或执行 test/hook body。
4. Worker 返回有大小上限的 Catalog JSON。Server 校验相对路径、case 数、字符串长度、项目 revision、SHA 和 schema 后持久化；扫描失败保留旧 Catalog 并记录错误。
5. UI 展示 HEAD SHA、扫描时间和差异。Admin 检查配置后将 Project 标记为 ready。ready 需要仓库可访问、至少一个有效 suite 且存在测试用例；不要求声明 scenario。

**发现执行隔离门槛：**Vitest 收集需要 import 项目测试代码和配置，仍可能运行模块顶层副作用。扫描必须使用可终止的独立子进程、无设备连接、无 Cloud Server/Worker token 注入、最小化环境变量、只读 checkout 和资源/时间限制。仅在团队授权的仓库执行。实现前先做 collection-only 技术验证，证明 hooks/test body 不运行；如果现有 Vitest 生命周期无法提供该保证，新增 Fliwright 自己的 catalog runner 或声明式 manifest，不得把普通 `run` 命令伪装成扫描。

扫描由 Worker 控制通道处理，不占用设备槽位。扫描队列有独立并发上限与持久状态；执行器只认合法 Project ID/revision 和 SHA。Worker 绝不接受浏览器传来的仓库地址或命令。

## 5. 用例目录与手动运行

新增项目详情的“测试用例”页：

- 显示当前 Catalog commit、配置 revision、扫描状态及“重新扫描”。
- 按 suite 分组，可筛选文件、名称和 scenario；显示用例 title path 与最近结果。
- Suite 行提供“运行套件”；具体用例行提供“运行此用例”。每个入口都要求确认 commit，默认直接运行，也可选择该 Catalog 中已声明的 scenario。
- Commit 选择优先显示 Cloud 已观察到的分支头；也允许输入完整 SHA。branch 选择在提交时解析为 SHA 并立即固定。
- 无可用 Catalog、Catalog 与目标 commit 不匹配或扫描失败时，不允许提交 case 级任务；可通过先扫描该 commit 解决。

Suite 运行继续映射到配置的测试文件 glob。Case 运行由新增 Fliwright CLI catalog/case-selection API 精确执行已发现的 caseId。不能把 Vitest `testNamePattern` 的任意正则直接暴露给 Web；执行前核对该 caseId 属于提交时引用的 Catalog。单 case 任务不得默默扩大为整个文件。

UI 在没有项目时显示创建项目入口；项目未 ready 时显示具体缺项（仓库凭据、无测试、scenario 解析失败等），不让用户提交后才发现缺配置。

## 6. 最新提交自动运行

### 触发策略

首期只支持 GitLab Push Webhook，默认关闭。Admin 启用时选择一个分支（默认项目 defaultBranch）和要自动执行的 suite/scenario 组合。首期不自动运行所有 scenario，也不处理 tag、MR 合并请求或任意分支，避免产生不可控设备负载。

Webhook endpoint 使用独立 route，不经过浏览器 session；按 GitLab Secret Token 常量时间校验，验证仓库身份、分支、40 位 commit 和 push 类型。记录 delivery/event ID 幂等去重。删除分支、空 SHA、非配置分支、无变化 commit 和关闭策略都忽略并记录简要审计事件。Endpoint 只接受受支持版本的 Push Hook，设置 body 限制与速率限制。

Webhook 只写入持久事件/扫描工作项，快速返回 202；不在 HTTP 请求期间 clone 或执行代码。事件处理后 Worker 扫描该 SHA 的 Catalog；扫描成功后按项目 autoRun policy 创建任务。任务固定为事件中的 SHA，不在执行时再解析“latest”。

### 合并连续推送

对同一 Project、branch、auto policy revision 和 suite/scenario：

- 排队中的旧自动任务可被标记 `superseded`，并关联新 SHA 的请求；最新任务保留 FIFO 中新位置。
- 已领取/运行的任务继续完成，不被新 push 自动取消。
- 同一 commit 和策略重复 delivery 通过幂等键合并为同一请求。
- 每次 supersede 和触发都可审计；手动任务不参与合并。
- 只在最新 SHA Catalog 扫描成功后生成任务；失败显示扫描失败，不运行旧 Catalog 冒充最新测试。

“最新”因此指 GitLab webhook 通知的目标分支 HEAD commit，并非执行开始时仓库远端的 HEAD。重复/乱序 webhook 用 branch head 时间戳和 ancestry/更新序号保护，不能让旧事件回滚记录的最新 SHA；无法可靠判断事件先后时以 GitLab delivery 元数据和 git commit ancestry 核验，存疑事件只刷新 HEAD/扫描而不触发重复任务。

自动运行的设备不足时照常入队并显示队列位置；没有可调度槽位则显式显示阻塞原因。Auto run 不是门禁，若 GitLab pipeline 需要等待通过/失败，继续由 CI 客户端提交并 wait，沿用现有 gate 行为。

## 7. Worker 与服务 API

建议新增 server API：

- `GET/POST /api/projects`、`GET/PUT/DELETE /api/projects/:id`。
- `POST /api/projects/:id/scans` 创建扫描；`GET /api/projects/:id/scans/:scanId` 查看进度。
- `GET /api/projects/:id/catalogs`、`GET /api/projects/:id/catalogs/:catalogId` 查询目录。
- `POST /api/projects/:id/requests` 提交 suite/case 任务。
- `PUT /api/projects/:id/auto-run` 更新自动策略。
- `POST /api/webhooks/gitlab/:projectKey` 接收 Push Hook。
- Worker 控制面 claim/heartbeat/result API 增加 `catalog_scan` 类型，继续使用 Worker 身份并为扫描作业发放范围受限的短期凭据或由 Worker 本地凭据管理器解析仓库只读凭据。

共享 schema 在 `@fliwright/cloud-protocol`；Project/Catalog/scan job API DTO 要 `.strict()` 并限制数组、文本、manifest bytes、文件数、case 数和扫描耗时。Webhook secret 只保存摘要。仓库 URL 拒绝 URL 内嵌 user/password、危险协议和本机/内网地址注入；Git 仅允许部署配置的 SSH/HTTPS host allowlist，避免 SSRF 和任意本地路径 clone。

Cloud SQLite 增加明确 migration：projects、catalog_scans、catalogs、webhook_deliveries、branch_heads，以及请求来源/选择元数据。迁移只读既有 `targets`，建立对应 Project 与权限映射，已有请求和报告保持可读；后续移除 JSON target API 需在新项目 API 上完成后单独清理，不并行维护两套可写配置源。`PRAGMA user_version` 单调升级，旧版数据库回归测试必须覆盖。

## 8. 网页信息架构

主导航增加“项目”。列表显示 ready/扫描失败/配置不完整、仓库、默认分支、Catalog commit、自动运行开关和最近结果。

项目详情使用项目级标签页：概览、测试用例、运行记录、设置。设置按常见字段提供表单，危险安装命令以受限高级配置呈现并只允许 admin 修改；提供仓库连接检测、扫描、Webhook 配置与策略状态。Webhook secret 只在创建时显示一次，不能从 API 回读。

运行记录仍复用全局队列和报告详情。任务详情显示来源、project、commit、branch、suite/case、scenario、config revision、catalog revision 和触发策略。超越/去重任务显示明确关联，原始运行结果和报告不可覆盖。

## 9. 权限与安全

- 仓库代码、`fliwright.config.ts`、测试模块和安装步骤都属于可执行的团队代码。只有 admin 可绑定仓库和设置凭据；member 不得输入仓库地址、命令、路径或任意 selector。
- Worker 仓库凭据只读、按仓库限定，扫描进程不接收发布令牌、Cloud bearer token、代理身份密钥或其他项目凭据。优先使用部署侧 SSH agent/credential helper，禁止把 token 拼入 clone URL、命令行和日志。
- Webhook 使用独立 secret，常量时间比较、delivery 去重、body 限制和审计；普通 session 与 CSRF 保护不能替代 Webhook 验签。
- Checkout 固定 SHA，禁用 Git hooks；阻止路径逃逸、软链接越界和配置引用 checkout 外文件。扫描和执行共享受限 Worker 主机但使用不同目录、环境白名单、进程组与资源限制。
- 项目删除需先拒绝有活动任务的删除，Catalog 历史按保留策略清除；删除不撤销已发布报告的审计事实。

## 10. 实施分期

### Phase 0：发现器技术验证

验证真实 Fliwright fixture 项目在无 VM Service 时能否 collection-only 获取所有文件和完整 title path；确认测试/hook body 未执行，scenario 能从项目配置解析。若 Vitest 插件或模块顶层副作用破坏隔离，形成 manifest/runner 设计后再进入后续阶段。

### Phase 1：Project 模型与设置

在 Cloud Protocol 定义 Project 和 repository credential reference；SQLite migration 迁移旧 targets；server API 与权限；网页项目列表、创建/编辑表单、连接检测。暂不接自动触发。回归已有 request 快照、槽位授权、数据库升级和 admin/member 权限。

### Phase 2：Worker 扫描与 Catalog

新增设备槽位外的扫描控制队列、Worker scan executor、CLI collection/catalog API、Catalog 校验持久化。加超时、取消、结果大小限制、无 token 环境和错误状态。扫描不得占设备槽位；并发/重试/过期扫描有明确定义。

### Phase 3：用例浏览与手动执行

新增项目 Catalog UI、提交 suite 和 case 请求、exact case selection 执行支持。固定提交和 Catalog 引用；报告任务元数据；branch head 解析。新增 UI/API/Worker 端到端用例，验证 case selection 不扩大执行范围。

### Phase 4：GitLab Push 自动运行

Webhook 验签、delivery 去重、branch head 和记账、扫描事件 pipeline、autoRun policy、旧排队任务 supersede、新任务创建和 UI 审计。覆盖重复/乱序事件、push 风暴、扫描失败、无设备、policy 更新、手动任务不被合并等场景。

### Phase 5：部署与运营闭环

更新 server/Worker 示例配置、GitLab Webhook 设置说明、权限/凭据轮换、备份恢复和保留策略；真实 GitLab 项目与专用 Worker 验证 Push Hook 到报告完整链路。重大稳定行为完成后更新 README、生成 feature docs 和 Harness capability catalog。

## 11. 验收条件

1. Admin 可绑定受允许的 Git 仓库并在 Web 配置项目；无 JSON 手改即可完成初次接入。
2. 指定 commit 的 Catalog 显示准确的 suite、文件、scenario、完整测试名称和可执行状态；扫描无 VM Service、无设备操作、无实际测试/hook 执行。
3. member 可从目录运行单 suite 或单 case；Worker 执行固定 commit，单 case 不误跑同文件其它 case；结果可在原报告回放。
4. 改项目设置后旧请求仍使用原配置快照；新请求使用新 revision；Catalog 和报告链接不串版本。
5. GitLab Push Hook 仅对启用分支、正确签名和有效 delivery 生效；运行任务 commit 与 Push Hook SHA 完全相等。
6. 连续 push 只 supersede 尚未领取的自动请求，活动执行与手动请求保留；重复 delivery 不重复排队；乱序旧事件不会取代新 branch head。
7. Webhook secret、仓库凭据及执行环境秘密不出现在数据库明文、URL、进程参数、日志和 Catalog。
8. 迁移覆盖全新 DB 与当前版本 DB；已有队列、报告、分享、设备策略和 Worker 租约在升级后保持一致。

## 12. 主要风险与决策

- Vitest collection 仍会执行测试模块顶层代码。Phase 0 是硬门槛；如果无法达到可接受隔离，改用受控 catalog manifest 或独立 runner，不直接在 Server 导入仓库模块。
- 多个自动 suite/scenario 对应多条设备任务，push storm 可能形成队列压力。首期限定一个分支、显式选择 suite/scenario、合并未开始任务并限制每项目扫描并发。
- GitLab Webhook 只提供事件，不解决私有仓库凭据。凭据必须由 Worker 管理员预配并可轮换，Cloud Server 不持有 clone secret。
- 当前 `ApplicationTarget`、槽位授权与已有任务都使用 target ID。Phase 1 migration 要保留稳定 ID 和旧任务 JSON 快照，避免把表面重命名误做成数据丢失；只有新 Project API 成为唯一写入源后再移除旧管理面。
- Webhook 测试只验证 Cloud 自身入队语义；真实 GitLab 到报告链路、仓库主机 allowlist 和 Worker 凭据范围需要部署环境验收，不能仅凭单测宣称完成。
