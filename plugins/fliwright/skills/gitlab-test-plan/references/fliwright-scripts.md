# 从测试计划生成 Fliwright 脚本

用户要求生成自动化脚本或完整流程时读取本页。先读取并使用
[write-fliwright-tests](../../write-fliwright-tests/SKILL.md)，沿其路由只加载当前用到的参考资料。
本页负责验收标准到脚本、绑定、结果的衔接；fixture、locator、scenario 和断言 API 以该 Skill 及目标项目版本为准。

## 明确输入和项目

先生成并校验 `plan.json`，保留 checklist 优先规则和最终用例 ID。
目标 App 项目必须明确；不要在 Fliwright 工具仓库里创建目标 App 的业务测试。
读取目标项目的 AGENTS、测试配置、附近测试和 `.fliwright/support/`，确认已安装版本及命令。
缺少项目位置时先询问，同时继续不依赖该位置的计划工作。

对每条计划用例核查已有测试：已完整覆盖的可以复用绑定；缺失的新增，部分覆盖的在本次需求范围内补充断言。
不要只复制测试标题，也不要重复创建已存在的等价用例。

## 给编写 Skill 的上下文

当前会话向 `write-fliwright-tests` 提供以下事实；不启动另一个 Codex 进程：

- GitLab Item URL、验收标准编号、原文及用例 ID。
- 用例前置条件、操作、每步预期及最终预期。
- 目标项目路径、已有 support fixture、命名 scenario、mock 与实际 UI 标识。
- 已覆盖部分、仍缺少的行为及需求待确认项。

编写时检查 App 源码或运行中的 snapshot，确认 route、Key、semantics、数据和扩展能力。
只使用能从目标项目或运行事实确认的标识；不要猜定位器、接口、provider 或 scenario 名称。
发现不可确定的业务预期时保留问题，不用当前有缺陷的实现反向定义正确结果。

## 写作和核查

验收用例是带有效断言的持久测试，放入目标项目 `.fliwright/tests/*.test.ts`。
优先复用项目 support 模块，否则使用 `@fliwright/vitest` 的 `test` / `expect`。
按编写 Skill 处理 timeline、稳定定位器、等待、named composed `TestScenario` 及认证状态。
在代码中保留 Item、计划用例 ID 和验收标准编号的追溯信息，可用简洁注释；完整业务步骤仍以实际脚本为准。

### 组织 Item 的 Mock 数据

先检查项目 `.fliwright/mocks/api/` 的共享响应和已有命名场景。只把本 Item 独有的
边界、异常或复现数据新增到 `.fliwright/test-plans/<iid>/mocks/api/`，保持现有
version 1 端点规则 schema，不复制完整共享目录，也不把 Item 文件加入共享 index。
编写 JSON 时使用 `write-fliwright-mock-rules` Skill。

场景使用 `kind: 'mocks', sources, rules`：source 显式列出 name、directory、files，
rules 通过 source、method、endpoint、rule 选择响应。父子场景的规则会统一应用；
覆盖继承的 method/endpoint 时显式写 `replace: true`。每条 case 选择对应命名场景，
无需各自创建 Mock 目录。场景可放 Item 目录的 `scenarios.ts`，须显式导入并注册到
项目配置；测试仍放 `.fliwright/tests/`。完整示例与执行限制见
[共享与 Item 规则指南](../../write-fliwright-tests/references/mock-rule-sets.md)。

plan.json 继续保存业务前置条件和 file/name 绑定，不向其严格 schema 填入 Mock 响应或
自创场景字段。运行证据中的 `mockRuleSet` 记录实际规则来源与内容摘要；没有真实运行
证据时仍标为未验证。认证沿用 App 自有 `auth.seedLoggedIn`，业务状态通过 Mock 返回。

每个测试应有能让对应验收标准不满足时失败的断言。
空测试、`expect(true)`、只检查“页面存在”、吞掉异常或永久 skip/todo 都不能视为完成验收脚本。
不把 AI 生成步骤加入日常 CI；落地脚本应使用确定性操作和断言。

运行目标项目适用的最窄静态检查，并收集测试目录以获得真实 file 和完整 runner 名称。
已有 Fliwright 项目可用 `fliwright catalog --json`；遇到收集错误先检查 fixture 导入和配置。
参数化测试绑定展开后的唯一名称，不手写猜测 suite 拼接结果。
目录收集会导入可信项目模块但不执行测试主体；它不能证明测试通过。

## 全量覆盖与运行

按每条计划用例的前置状态、动作和全部断言编写脚本；没有 checklist 的需求推导用例也使用同一流程。
不要只跑通 smoke 或先实现的一小批测试就结束。优先补齐已有部分脚本；可复用的辅助代码放 support。
功能、视觉、平台矩阵等独立验收目标可在计划设计阶段拆为分别可验证的用例，保留全部标准映射；
不能在验证失败后通过拆分、删断言或缩小范围把缺口变成通过。

静态检查及 catalog 收集通过后，按 [数据契约](workflow.md#记录脚本覆盖与交付检查)
用 `test-plan update <plan.json> --updates - --catalog <临时 catalog>` 一次记录全量覆盖情况，省略 `--output` 原子更新正式计划。完整用例记录 `complete` 与真实 file/name；
部分覆盖记录 `partial`、缺少的操作/断言及相关测试；实际阻塞记录 `blocked` 及恢复所需条件。
一个完整用例匹配唯一收集结果，不同完整用例不重复使用同一结果；部分证据可供多个用例引用。

交付前运行 `test-plan validate <plan.json> --catalog <临时 catalog> --require-scripts`。
有 pending/partial 时继续完成可做的工作；确实无法继续的缺口写入正式计划，明确交付为部分完成。
`valid` 仅表示结构合法，`scriptsReady` 才表示全部用例已声明完整覆盖且 catalog 匹配唯一；
二者都不证明断言覆盖正确或实际执行通过。检查失败仍可生成缺口报告，不能忽略失败后宣称脚本任务完成。

按目标项目现有配置，用 `fliwright run --test <file> --json` 验证实际 App 行为；
需要命名场景时使用项目已有的 `--scenario`。CLI 参数以安装版本 schema 为准。
默认省略 `--runs-root` 和 `--input` JSON 中的 `runsRoot`，使运行证据与 VS Code
Run Viewer 共用项目目录配置；不要为每个 Item 创建 `test-plans/<iid>/runs/`。
默认目录及覆盖规则见 [存储约定](../../fliwright-cli-workflows/references/commands/common.md#ci-evidence)。
直接读取运行命令返回的真实 runId、outputDir 和 manifestPath，交付时链接到真实产物；
默认不再向 Item 目录导出运行摘要、JUnit 或 CLI envelope。显式用户导出才使用 `--output`，
该参数不改变截图、日志和 timeline 的存放位置。
用户指定或 CI 配置了独立运行目录时保留该选择，后续查询使用同一实际根目录。
请求包含审核报告时，把已确认的被测 App、version、build、commit、platform、environment
通过 `run --release` JSON 对象保存到实际运行结果；未确认的字段省略，不从源码状态猜测。
缺少 VM service、设备或 App bridge 能力时完成可做的静态检查，列出未验证项及恢复命令；
不要把静态检查、收集或绑定成功算成运行通过。

失败时读取 report、timeline、日志和截图再诊断。修正生成脚本自身的问题可以继续；
真实业务缺陷则保留失败证据并报告，不弱化断言、修改验收标准或自动修复业务代码。
失败测试也可以保留正确的绑定，报告应展示真实失败并阻止发版。

## 交付对应关系

通过 `test-plan coverage <plan.json>` 重生成唯一覆盖清单；用例 ID、脚本位置、测试名和缺口
均来自正式计划，不手填运行状态。静态检查和实际执行结果在交付中说明，运行证据链接到真实
run/attempt。组合 Mock 的来源以对应 attempt 的 timeline `mockRuleSet` 为准，不根据当前
文件反推历史数据。不要额外生成重复的计划设计、审计 Markdown 或映射 JSON。
没有运行时写“待执行”及原因；不要将静态解析、收集或绑定称为通过。
请求包含发版审核报告时，继续 [报告流程](release-review.md)，无需再次要求用户下达报告指令。
