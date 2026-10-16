# @fliwright/mcp

Optional Model Context Protocol adapter for Fliwright. The CLI remains the
authoritative interface for installation, deterministic execution, and CI;
this package exposes the same runtime capabilities to coding agents.

```json
{
  "mcpServers": {
    "fliwright": {
      "command": "npx",
      "args": ["-y", "@fliwright/mcp"]
    }
  }
}
```

The compact `core` tool profile is used by default. Specialist `development`,
`tdd`, and `flow` profiles are opt-in through `FLIWRIGHT_MCP_TOOL_PROFILE`.

The default profile contains exactly eight tools:
`fliwright_status`, `fliwright_connect`, `fliwright_observe`,
`fliwright_interact`, `fliwright_run`, `fliwright_scenario`,
`fliwright_mock`, and `fliwright_record`. Use the CLI for deterministic setup,
CI execution, exit codes, and artifact export; use MCP for typed, long-lived
agent sessions.
