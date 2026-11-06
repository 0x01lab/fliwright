# 数据契约与命令

Skill 在当前会话生成草稿；独立 `@fliwright/test-plan` 工具没有 AI 调用。

## 找到工具

优先使用已安装的 `test-plan --help`。在 Fliwright 仓库中可以使用：

```sh
pnpm --filter @fliwright/test-plan build
pnpm test-plan --help
```

目标项目位于其他目录时，使用找到的工具仓库的绝对 CLI 路径：

```sh
node /path/to/fliwright/packages/test-plan/dist/cli.js --help
```

以下命令中的 `test-plan` 表示找到的可执行命令；使用绝对输入输出路径可避免混淆目标项目和工具目录。工具需要 Node.js 20+、已安装且对目标 GitLab 主机已认证的 `glab`。不会重新登录或输出 token。

工具发现由当前会话完成，不把这些命令变成用户必须逐步执行的操作。若用户已指定本地 Fliwright checkout，可在包尚未构建时于该 checkout 构建独立包，再从目标项目调用绝对 CLI 路径。不要假设 plugin 自带 Node 可执行包，也不要从名称猜测未发布包的下载地址。无法找到工具时说明需要安装工具或提供 checkout 位置，仍可继续不依赖工具的需求分析。

## 最小持久目录

默认长期文件只有 `plan.json`（包含完整原始来源、验收条件、用例和当前绑定）与工具派生的
`coverage.md`。脚本仍在项目 `.fliwright/tests/`，按需保留 Item 的 `scenarios.ts`、`mocks/api/`
和被脚本实际引用的 `design/`。不要求额外的计划设计、审计、校验结果或 CLI envelope 文件。

为本次流程创建系统临时目录，fetch 快照和 catalog 放其中；草稿与 updates 优先用 `-`
从 stdin 输入。一次命令只允许一个 JSON 输入使用 stdin，其他输入使用临时文件。
组装完成后原始来源已经嵌入正式计划，流程成功后删除本次临时目录；失败时保留输入供修正。
不在 Item 目录创建 `.tmp/`、隐藏历史目录或多轮副本来替代真正的文件收敛。

```sh
task_tmp=$(mktemp -d)
```

`update` / `bind` 省略 `--output` 时原子更新输入计划；校验失败、取消或检测到其他更新时
保留原文件。显式 `--output` 只用于需要新导出的场合，目标必须不存在。锁文件表示正在写入，
崩溃后残留时先确认没有写入进程再处理，不能自动忽略锁。fetch / assemble 仍不覆盖已有输出。
需求重新获取或用例重写先在临时目录组装并核对差异，再更新正式计划；变化的标准/用例必须
重新核查绑定。不要为了省文件跳过来源引用、catalog 核对或全量脚本检查。

## 获取源快照

```sh
test-plan fetch https://gitlab.example.com/team/app/-/work_items/128 \
  --output "$task_tmp/snapshot.json"
```

支持项目 `/-/issues/<iid>`、`/-/work_items/<iid>` 和群组 Work Item HTTPS URL；可一次传入多个链接。每个 Item 保存 GitLab identity、标题、描述、非系统评论和读取/更新时间。依赖 GitLab GraphQL 的 `namespace.workItem` 及 description/notes widgets。主机不支持或无访问权限时报告原因，不制造来源快照。

## 写草稿

根对象为 `items`。每个快照 Item 必须出现一次，`sourceUrl` 必须等于快照中返回的 URL。草稿用例不要写 `id`、`automation`、`binding` 或执行状态；工具分配 ID，并生成 `schemaVersion: 2` 的计划，每条用例初始化为 `pending`。源快照格式仍为 version 1。

```json
{
  "items": [{
    "sourceUrl": "https://gitlab.example.com/team/app/-/work_items/128",
    "basis": "acceptance-checklist",
    "acceptanceCriteria": [{
      "id": "AC-01",
      "text": "优惠券抵扣后的实付金额正确",
      "source": {
        "kind": "description",
        "quote": "实付金额应扣减优惠金额。"
      }
    }],
    "cases": [{
      "title": "有效优惠券抵扣订单金额",
      "description": "核对优惠抵扣后的订单金额",
      "acceptanceCriteria": ["AC-01"],
      "preconditions": ["有满足使用条件的优惠券和可结算商品"],
      "steps": [{
        "action": "选择优惠券并提交订单",
        "expectedResult": "订单创建成功，并展示优惠金额及实付金额"
      }],
      "expectedResult": "实付金额等于商品总额减优惠金额"
    }],
    "openQuestions": []
  }]
}
```

示例数值和业务行为必须替换为真实 Item 的内容。`basis` 为 `acceptance-checklist` 或 `requirements`；后者仅用于没有验收 checklist 的 Item。

`source.quote` 是原文中连续、非空的片段，保留 Markdown 语法也可；无需复制整个 Item。`kind: description` 引用描述。引用评论时写 `kind: comment` 和该快照中的 `commentId`，quote 必须出现在该评论里。`text` 可整理为可读标准，但不能改变原意。

每个用例必须引用本 Item 内至少一个已声明的标准。ID 在同一 Item 内唯一；不同 Item 可各用 `AC-01`。没有可明确标准时，保留 `acceptanceCriteria: []`、`cases: []` 并说明 `openQuestions`。标准无法生成测试时，把标准 ID 及原因写入问题；未覆盖且无问题的草稿会被拒绝。

## 合并、校验和覆盖清单

```sh
test-plan assemble --snapshot "$task_tmp/snapshot.json" \
  --draft - --output /target/project/.fliwright/test-plans/128/plan.json
# stdin 提供上面的真实草稿 JSON；通过工具 stdin 或带引号的 heredoc 传入。

test-plan validate /target/project/.fliwright/test-plans/128/plan.json
```

输出检查结构、来源引用、标准映射及关联唯一性；`coverage` 返回 pending/partial/blocked/complete 数量，`gaps` 包含每条缺口。`automationComplete` 表示全部用例声明完整覆盖、无未覆盖标准或待确认问题；`scriptsReady` 还要求提供 catalog 且所有测试引用唯一存在。`valid: true` 仅表示结构合法，不表示脚本完整或测试通过。

最终用例 ID 由 Item、用例内容及关联验收标准内容确定。同样内容得到相同 ID；需求或用例内容变化后不要直接继承旧绑定。覆盖清单示例：

| 验收标准 | 来源原文 | 用例 ID | 缺口 |
| --- | --- | --- | --- |
| AC-01 | 实付金额应扣减优惠金额。 | 实际生成的 GL-128-... | 无 |

## 记录脚本覆盖与交付检查

先在目标项目执行 `fliwright catalog --json > "$task_tmp/catalog.json"`，将完整返回保存在本次临时目录。`validate` / `bind` 也支持 `--catalog -` 接收管道输入。
工具接受 catalog 数据对象或 CLI 的成功 envelope，只读取 JSON，不运行测试或导入项目模块。
完整测试名称为 `titlePath` 用空格连接，参数化用例使用展开后的名称。

为每条已核查的计划用例构造覆盖决定，通过 `--updates -` 输入（确需文件时放临时目录），示例中的 ID、路径、名称和原因替换为实际值：

```json
{
  "cases": [
    { "caseId": "GL-128-ACTUAL_COMPLETE_ID", "automation": { "status": "complete" },
      "binding": { "file": ".fliwright/tests/checkout.test.ts", "name": "checkout applies coupon" } },
    { "caseId": "GL-128-ACTUAL_PARTIAL_ID", "automation": { "status": "partial", "reason": "缺少金额边界断言",
      "tests": [{ "file": ".fliwright/tests/checkout.test.ts", "name": "checkout coupon basics" }] } },
    { "caseId": "GL-128-ACTUAL_BLOCKED_ID", "automation": { "status": "blocked", "reason": "金额上限待业务确认" } }
  ]
}
```

```sh
test-plan update /target/project/.fliwright/test-plans/128/plan.json \
  --updates - --catalog "$task_tmp/catalog.json"

test-plan validate /target/project/.fliwright/test-plans/128/plan.json \
  --catalog "$task_tmp/catalog.json" --require-scripts
test-plan coverage /target/project/.fliwright/test-plans/128/plan.json
```

`update` 校验整批修改后原子更新当前计划，未提及的用例保持原样；任何重复/未知 ID、非法状态、重复完整关联或不存在/不唯一的测试引用都会拒绝整批写入。
只要计划引用测试，就必须提供 catalog；partial 至少一个相关测试，partial/blocked 必须有非空原因。
`complete` 必须有 binding；其他状态不能有完整 binding，以免把部分覆盖算作通过。
目录清单仅能证明测试被收集，AI 仍须核对前置条件、步骤和全部断言。计划没有 passed/failed 字段。

单条完整关联仍可用：

```sh
test-plan bind /target/project/.fliwright/test-plans/128/plan.json GL-128-ACTUAL_ID \
  --file .fliwright/tests/checkout.test.ts \
  --name 'checkout applies coupon discount' \
  --catalog "$task_tmp/catalog.json"
```

`file` 为目标项目相对路径；`name` 是执行产物中的完整名称。省略 `--output` 时修改原子写回原计划，保留完整来源；显式新输出不会覆盖其他文件。`bind` 核对 catalog，但不检查源代码或运行测试；当前 AI 在调用前核查覆盖。

`--require-scripts` 在输出 JSON 后，对 pending/partial/blocked、缺少 catalog、失效或不唯一的测试引用、未覆盖标准、待确认问题和空计划返回退出码 1。
补齐可做的工作后再次收集 catalog 并检查。确实受阻时保留缺口及失败结果，继续生成可审阅报告并说明部分完成。
仅生成计划的请求不用强制脚本检查。审核报告引用最终更新计划，不能继续用最初的 pending 版本。

## 生成覆盖视图和交付

```sh
test-plan coverage /target/project/.fliwright/test-plans/128/plan.json
# 仅打印 Markdown，不写文件：
test-plan coverage /target/project/.fliwright/test-plans/128/plan.json --output -
```

默认重生成计划旁的 `coverage.md`，包含来源、标准与原文、用例 ID、脚本/测试名、覆盖状态、
具体缺口和待确认事项。该文件可随时从计划重建，不手工维护第二套事实。它不读取 run、不声明
执行通过，也不能代替 `validate --catalog ... --require-scripts`。只有需要其他位置才指定
`--output <path>`；不能输出到原计划或通过符号链接覆盖其他文件。

运行命令响应直接供当前会话使用，不保存 `run*.result.json`、JUnit、catalog envelope 或
validation JSON 到 Item 目录。真实运行证据和审核报告沿用 CLI 返回的 outputDir，详见报告流程。
