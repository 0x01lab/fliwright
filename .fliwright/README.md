# Fliwright Local Test Assets

This directory stores workspace-local data used by Fliwright tools, tests, and the VS Code extension.

## Layout

```text
.fliwright/
├── forms/
│   └── form-rules.example.json
└── mocks/
    ├── README.md
    ├── api/
    │   └── get-token.example.json
    └── mock-index.example.json
```

## Form Data Rules

Form rule files are JSON and follow the `FormRulesFile` schema used by `JsonRuleLoader`:

```json
{
  "version": 1,
  "locale": "zh-CN",
  "rules": [
    {
      "match": { "label": "手机号" },
      "type": "REGEXP_MOCK",
      "pattern": "1[3-9][0-9]{9}"
    }
  ]
}
```

The VS Code extension should load `.fliwright/forms/*.json` and pass the selected file or directory to `FormHelper`.

## API Mock Files

API mock files are JSON. Each endpoint file describes one API endpoint and multiple response rules:

```json
{
  "version": 1,
  "name": "Get Token List",
  "method": "GET",
  "endpoint": "/v1/public/token",
  "rules": [
    {
      "name": "success",
      "status": 200,
      "delay": 0,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "success": true,
        "data": {
          "rows": []
        }
      }
    }
  ]
}
```

The VS Code extension can scan `.fliwright/mocks/api/*.json`, let the user choose a rule, and apply it through `driver.mock.route(endpoint, response)`.
