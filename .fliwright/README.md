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

When rules share response fields, define them once in `baseRule` and make each
`rules[]` entry an override:

```json
{
  "version": 1,
  "name": "User Info",
  "method": "POST",
  "endpoint": "/api/v1/user/info",
  "baseRule": {
    "status": 200,
    "delay": 0,
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {
      "username": "qa-user",
      "email": "qa@example.com",
      "phone": "+85268****85",
      "otpConfigured": true
    }
  },
  "rules": [
    {
      "name": "success"
    },
    {
      "name": "mobile-add",
      "removeBodyFields": ["phone"],
      "body": {
        "otpConfigured": false
      }
    },
    {
      "name": "server-error",
      "status": 500,
      "removeBodyFields": ["username", "email", "phone", "otpConfigured"],
      "body": {
        "error": "service unavailable"
      }
    }
  ]
}
```

Inheritance rules:

- `status`, `delay`, `headers`, and `body` inherit from `baseRule`.
- Rule fields override `baseRule` fields.
- `headers` are shallow-merged.
- Object `body` values are shallow-merged.
- Array, string, number, boolean, and null `body` values replace the base body.
- `removeBodyFields` deletes inherited object-body fields after the merge.

The VS Code extension can scan `.fliwright/mocks/api/*.json`, let the user choose a rule, and apply it through `driver.mock.route(endpoint, response)`.
