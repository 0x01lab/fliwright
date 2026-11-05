# 从绑定计划生成发版审核报告

仅在用户要求审核报告或完整流程时读取本页。使用目标项目的 Fliwright CLI，必要时读取
[fliwright-cli-workflows](../../fliwright-cli-workflows/SKILL.md)，按已安装版本的 `schema artifacts.report --json` 确认参数。

## 输入与来源

完整流程使用本次真实执行返回的 runId 和 runs root，以及本次校验后的绑定计划。
Item 目录只保留正式 `plan.json`、派生覆盖清单及脚本需要的场景/数据；运行证据和审核报告默认放在项目解析出的 `runsRoot` 中所选 run 的真实 outputDir。不要再复制运行摘要、JUnit 或 CLI envelope 到 Item 目录。
不要按 Item 路径猜测或新建 `runs/`；从 CLI 返回的 `artifacts.outputDir` 确定实际运行目录。
下面的 `--runs-root ACTUAL_RUNS_ROOT` 用于查询已有证据，不是要求执行测试时改写默认根目录。
仅生成报告时，使用用户指定的 run 或审核清单中的 runId，并复用已有计划与元数据。
用户提供的审核清单路径不存在时，检查当前 Item 目录的 `plan.json`、
运行命令返回值和已保存的 run 产物，找到对应计划及明确的 runId/runs root，使用下面的 `--plan` 入口。
不要仅因没有 `review.json` 就停止，也不要退回不带计划的报告或另写一份拼接 HTML。
通过 `artifacts show` 核对所选 run 的实际来源与状态；未指定 run 时可发现候选，
但不能把“最新”自动等同于当前发版的被测构建。候选无法唯一确定时询问一次。
报告生成是离线读取产物，不需要连接 App、访问 GitLab、调用 AI provider 或再次运行测试。
HTML 中 Item 仅保留标题链接，不嵌入描述、评论或验收原文引用；来源快照仍留在计划中用于校验。
报告保留验收标准、用例说明和执行结果。计划格式为 version 2，来源可为 checklist 或需求推导；每条用例都有 automation 覆盖声明。
报告用待编写、部分覆盖、受阻、待执行及实际运行结果表示进度；partial/blocked 显示具体缺口和相关真实执行证据，部分测试通过不代表整个用例通过。
保留计划中的来源快照及其时间，不刷新需求后继续沿用未经核查的旧绑定。

当前报告消费一个 run；多次执行的结果不能手工拼接或用旧的成功 run 替换本次失败。
尽量让同一计划范围内的测试在同一次运行中完成，未覆盖或未执行的用例保留为阻塞项。

发版合格判定还需要 App、版本、build、被测 commit、平台和环境。
优先复用用户提供或已存在且与本次运行相符的元数据；源码版本和当前 HEAD
只能说明源码状态，不能证明运行中的 App 使用该构建。无法确认时列出缺失信息，
仍生成包含 Item、全部计划用例及实际证据的 HTML；CLI 显示“未提供”并阻止放行。
不要用 `unknown`、`待确认`、当前 HEAD 或源码版本等占位内容填充字段来通过判定。

完整流程执行前，如果已确认被测构建信息，把它作为 `run --release` 的 JSON 对象传入，
CLI 会把这些显式输入保存到真实运行的 `report.json`，包括失败结果及导出产物。
仅提供已确认的字段即可；它们是调用方声明的构建信息，不是 CLI 对二进制来源的独立认证。
报告会复用这份记录；审核清单与记录的同名字段冲突时保持阻塞，不静默换成另一个构建。

## 清单与生成

生成前将本次校验后的 `plan.json` 保存为所选 run 目录中的 `test-plan.json` 审核快照（新文件，不覆盖已有快照），报告引用该快照。已有快照先核对是否属于同一计划；输入发生变化时，在该 run 内使用明确版本的审核文件。Item 目录仍只有一个可更新的正式计划。已有绑定计划但没有审核清单时，直接生成：

```sh
fliwright artifacts report ACTUAL_RUN_ID --runs-root ACTUAL_RUNS_ROOT \
  --plan ACTUAL_RUN_OUTPUT_DIR/test-plan.json \
  --output ACTUAL_RUN_OUTPUT_DIR/release-review.html \
  --allow-partial --require-qualified --json
```

CLI 自动在同一 run 的 HTML 旁写入 `release-review.review.json`，返回 `data.reviewPath`；
其中保存 runId、从真实运行复用的构建信息和相对计划路径。构建信息缺失时该对象可以为空，
Item、验收标准、待编写、部分覆盖、受阻及待执行用例仍需完整展示。`plannedCases`、`automatedCases` 与计划核对。
`--plan` 与 `--review` 二选一。报告输出固定使用所选 run 的真实 outputDir，不使用名称含糊的 final/release 多轮副本。同一 run、相同计划和元数据已有报告时可复用；确需更新报告时在该 run 内另存明确版本，不能覆盖原始运行证据。
已确认部分元数据时，可在 `--plan` 命令上增加 `--release` JSON，例如
`--release '{"app":"Exio","platform":"iOS","environment":"mock simulator"}'`；
这些示例值仍需与真实事实相符，未确认的 version/build/commit 留空缺失，不填占位文本。

使用 `run --device-id` 执行时，CLI 将所选设备的型号、名称、系统版本、真机/模拟器类型和标识保存到运行产物；报告仅在基础信息网格中显示设备型号，不另设测试设备区域。
仅附加 VM Service 时不猜测设备。历史运行若有已确认的设备资料，可在审核清单顶层补充 `device`：
`{ "id": "ACTUAL_DEVICE_ID", "name": "ACTUAL_DEVICE_NAME", "model": "ACTUAL_MODEL", "platform": "ios", "kind": "simulator", "osVersion": "ACTUAL_OS_VERSION" }`。
`platform` 可取 `ios` / `android`，`kind` 可取 `physical` / `simulator`；未知字段省略。
运行中记录的设备快照优先于审核清单，自动生成的审核清单保留该快照。缺少设备信息显示“未记录”，不改变发版合格判定。
不要根据当前在线设备反推历史运行的机型。

若有已确认的补充构建信息，或复用已有审核清单，在所选 run 的 outputDir 保存新的清单文件。
结构如下；示例值全部替换为已确认的真实值，未知字段省略（`release` 也可省略）：

```json
{
  "runId": "ACTUAL_RUN_ID",
  "release": {
    "app": "APP_NAME",
    "version": "ACTUAL_VERSION",
    "build": "ACTUAL_BUILD",
    "commit": "TESTED_COMMIT",
    "platform": "ACTUAL_PLATFORM",
    "environment": "ACTUAL_ENVIRONMENT"
  },
  "plan": "test-plan.json"
}
```

`plan` 相对清单所在目录解析。绑定更新原子写回正式 `plan.json`，报告引用完成校验后的正式计划在 run 目录的快照。计划或元数据变化后不能
沿用旧报告的合格结论；旧 HTML 只代表生成时的计划与选定 run。保留历史报告时，为其在 run
目录保存所用计划快照并引用该快照，避免可变计划影响历史报告的重建；快照属于该次审核证据，
不在 Item 目录另存 bound/final 版本。

```sh
fliwright artifacts report ACTUAL_RUN_ID --runs-root ACTUAL_RUNS_ROOT \
  --review ACTUAL_RUN_OUTPUT_DIR/release-review.review.json \
  --output ACTUAL_RUN_OUTPUT_DIR/release-review.html \
  --allow-partial --require-qualified --json
```

测试失败或证据不全时也生成展示已有证据的报告。`--require-qualified` 在报告写出后可返回
`RELEASE_NOT_QUALIFIED`；检查返回的 output、releaseReady 和 blockers，不能因此跳过交付报告，
也不能把命令的失败状态改成通过。若命令没有写出报告，则报告具体原因。
`missingReleaseFields` 单独列出缺失的构建字段；不要把它与截图/时间线等证据的 `missing` 混淆。

读取生成结果，并检查 HTML 中 Item、验收标准、用例、实际结果和证据缺口是否对应。
交付报告路径和阻塞项。测试全部合格仍需人工发版审核；Skill 不记录人工批准或发布 App。

仅生成报告的调用示例：

```text
$gitlab-test-plan 使用已有审核清单 <review.json 路径> 和其中指定的真实运行产物，生成发版审核 HTML 报告。
```

没有清单也可直接请求：

```text
$gitlab-test-plan 使用 Item 437 的绑定计划和已保存的测试结果生成发版审核 HTML；自动创建审核清单，缺失构建信息列为阻塞项。
```
