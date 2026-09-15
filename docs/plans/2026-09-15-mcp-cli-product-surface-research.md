# 研究：Fliwright 的 MCP 与 CLI 产品形态

日期：2026-09-15  
资料访问日期：2026-09-15（MCP Roadmap 页面标注最近更新为 2026-08-22）

## 结论

**不建议把 MCP 替换成 CLI。建议采用“双表面”策略：CLI 作为人类、脚本和 CI 的主产品入口；MCP 作为面向 Codex、Claude Code、GitHub Copilot 等 agent 宿主的协议适配层。** 两者解决的是不同层次的问题：

- CLI 定义稳定的命令、参数、退出码、日志和 JSON 输出，适合确定性的测试执行、调试和 CI。
- MCP 定义宿主与工具服务器之间的能力发现、授权和调用协议，适合让不同 AI 客户端按上下文调用 Fliwright。

因此，趋势支持“CLI-first UX + MCP adapter”，不支持“CLI 取代 MCP”。MCP 应保持为薄适配器，共用同一套 core/CLI capability 实现，避免维护两套测试语义。

## 官方趋势信号

| 官方来源 | 观察到的事实 | 对 Fliwright 的含义 |
| --- | --- | --- |
| [MCP Architecture](https://modelcontextprotocol.io/specification/2025-06-18/architecture) | MCP 采用 host–client–server 架构；host 管理多个 client、连接生命周期、权限和用户授权。协议基于 JSON-RPC，并通过 capability negotiation 声明能力。 | MCP 是跨宿主的集成协议，不是测试运行器或交互式 CLI 的替代品。Fliwright 应把测试执行语义留在 core/CLI，MCP 只负责暴露能力。 |
| [MCP Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | 工具是“model-controlled”：模型可通过 `tools/list` 发现工具并调用；规范明确实现可以选择适合自己的用户交互模式，并不规定必须使用某种 UI。规范还要求输入校验、访问控制、超时、审计和敏感操作确认。 | MCP 适合 agent 按需探索；确定性测试仍需 CLI 的显式命令、失败退出码和可复现参数。MCP 表面必须默认安全、限权并提供确认策略。 |
| [MCP Roadmap（2026-08-22）](https://modelcontextprotocol.io/development/roadmap) | 路线图把“HTTP over stdio”（以 Streamable HTTP 统一本地 stdio 绑定）、缓存/ETag、渐进式工具发现、工具结果形状、agent identity 与企业授权列为未来 6–12 个月重点；路线图同时声明这些是当前方向而非硬承诺。 | MCP 仍在快速演进。不要把 Fliwright 的核心 API、测试报告或状态模型绑定到尚未稳定的 MCP 扩展；应通过版本化 adapter 隔离协议变化。大量工具应支持延迟/渐进发现，而不是一次性灌入上下文。 |
| [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp) | Claude Code 可通过 MCP 连接“数百个”外部工具和数据源；支持本地 stdio 与远程 HTTP；`claude mcp add/login/logout` 等命令直接在 CLI 中配置和认证。文档还说明 MCP tool search 默认开启，工具会延迟到需要时再发现，以控制上下文占用。 | 主流 agent 将 MCP 作为扩展协议，但用户仍通过 CLI 管理服务器。Fliwright 应提供易于复制的 `fliwright mcp serve`/配置示例，并按领域分组工具、支持延迟发现。 |
| [GitHub Copilot：Adding MCP servers for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) | Copilot CLI 同时支持 `/mcp add` 交互命令、`copilot mcp add` 非交互命令和配置文件；支持 stdio、本地/HTTP、SSE（标为旧式并建议迁移）传输。MCP server 可立即加入 CLI，无需重启。 | CLI 与 MCP 是互补入口的直接官方范例。Fliwright 应把 CLI 配置和 MCP 配置设计为可互相转换，并优先支持 stdio 与 Streamable HTTP，不把 SSE 作为新功能重点。 |
| [OpenAI Codex CLI README](https://github.com/openai/codex/blob/main/README.md) 与 [Codex MCP CLI 实现](https://github.com/openai/codex/blob/main/codex-rs/cli/src/mcp_cmd.rs) | Codex 以本地 CLI 作为主要产品形态；其 `codex mcp` 原生命令提供 `list/get/add/remove/login/logout`，既支持通过命令启动 stdio server，也支持 Streamable HTTP URL、Bearer token 和 OAuth。 | 即使是 MCP 的重要宿主，Codex 也把 MCP 生命周期放在 CLI 命令中。Fliwright 不应在 CLI 与 MCP 之间二选一，而应让 `fliwright` CLI 成为安装、配置、运行和诊断的稳定入口。 |

## MCP 与 CLI 的职责边界

| 维度 | CLI | MCP |
| --- | --- | --- |
| 主要用户 | 开发者、CI、脚本、构建系统 | AI agent 宿主及其用户 |
| 调用模型 | 显式命令和参数；可版本控制 | 模型根据 schema 和上下文发现/调用工具 |
| 稳定性要求 | 退出码、stdout/stderr、JSON schema、幂等性 | capability negotiation、工具 schema、会话和授权兼容性 |
| 最适合的 Fliwright 场景 | `init`、`doctor`、`run`、`record`、`mock`、`tdd`、报告导出 | 观察 Widget、执行交互、诊断失败、按需生成测试、读取报告 |
| 失败处理 | 非零退出码、JUnit/JSON/trace 工件 | `isError` 工具结果、结构化错误、用户确认和审计 |

MCP 规范把工具调用定义为模型可控，但并没有规定测试流程的编排、重试策略、工件目录或 CI 退出语义。这些应由 CLI/core 定义；MCP 工具调用 CLI/core 能力并返回结构化结果。

## 对 Fliwright 的建议

### 产品表面

1. **CLI-first：** `fliwright` 是文档、安装向导和 CI 示例中的默认入口。所有核心能力提供稳定的命令、`--json`/机器可读输出、明确退出码、超时和报告路径。
2. **MCP 保留但收敛：** 保留独立 `@fliwright/mcp`，定位为“agent adapter”。MCP server 通过 stdio 默认启动，另提供 Streamable HTTP；SSE 仅作为兼容路径。
3. **单一实现来源：** MCP tool handler 只调用 `@fliwright/core`/CLI capability，不复制定位器、等待、Mock、报告或 VM-service 逻辑。CLI 与 MCP 的 schema 从同一领域命令模型生成或进行契约测试。
4. **工具分组与渐进发现：** 当前能力较多时，按 `run/observe/mock/diagnostics/flow/tdd` 分组；默认只暴露安全的只读观察和运行工具，调试/状态变更工具显式启用。为未来 MCP progressive discovery 留出命名空间和分页设计。
5. **配置互通：** 提供 `fliwright mcp serve`、`fliwright mcp doctor` 和 `fliwright mcp config`，输出可直接粘贴到 Codex、Claude Code、Copilot CLI 的 stdio 配置；支持环境变量引用，不把 VM-service URL、token 或项目密钥写入日志和仓库。

### 发行与兼容策略

- 将 CLI 版本作为用户可见的兼容基线；MCP server 与 core 使用独立但兼容的 semver 约束。
- 对 MCP 工具输入/输出建立协议契约测试，覆盖 capability negotiation、`tools/list` 分页、结构化错误、超时、取消和敏感操作确认。
- 对 CLI 建立 golden tests，锁定退出码、JSON schema 和报告目录；真实 Flutter smoke 仍通过 CLI 运行，MCP 测试只验证适配层调用同一能力。
- 关注 MCP Roadmap 的 HTTP over stdio、渐进发现和 agent identity，但在正式规范落地前不要把它们当作 Fliwright 的必需依赖。

## 最终决策

采用 **“CLI 主产品 + MCP agent 适配器”**：

```text
开发者 / CI  ──>  fliwright CLI  ──┐
                                   ├─> @fliwright/core ─> Flutter VM Service / Bridge
AI agent     ──>  MCP server  ─────┘
```

只有在未来 Fliwright 的主要价值变成远程多租户 agent 平台、且调用方几乎全部通过 MCP 时，才有理由把 MCP 提升为主产品表面。就当前 Flutter 白盒 E2E 定位和主流工具的官方做法看，替换 MCP 会损失 agent 生态兼容性，而替换 CLI 会损失确定性测试与 CI 可用性。
