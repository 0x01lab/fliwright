# API Mock Configuration

Mock endpoint files live in `.fliwright/mocks/api/*.json`.

Each file describes one endpoint and one or more named response rules. The minimal shape is:

```json
{
  "version": 1,
  "name": "Example API",
  "description": "Optional description",
  "method": "GET",
  "endpoint": "/api/example",
  "rules": [
    {
      "name": "success",
      "status": 200,
      "delay": 0,
      "headers": {
        "Content-Type": "application/json"
      },
      "body": {
        "success": true
      }
    }
  ]
}
```

Mapping to `MockManager`:

- `endpoint` becomes `driver.mock.route(endpoint, ...)`
- `method`, `status`, `headers`, `body`, and `delay` become the mock response
- `rules[].name` is a selectable scenario name in the VS Code extension

When many rules share the same response fields, put them in `baseRule` and keep
each entry in `rules` as an override:

```json
{
  "version": 1,
  "name": "User Info API",
  "method": "GET",
  "endpoint": "/api/user-info",
  "baseRule": {
    "status": 200,
    "delay": 0,
    "headers": {
      "Content-Type": "application/json"
    },
    "body": {
      "success": true
    }
  },
  "rules": [
    {
      "name": "success",
      "body": {
        "name": "Ada"
      }
    },
    {
      "name": "server_error",
      "status": 500,
      "removeBodyFields": ["name"],
      "body": {
        "success": false,
        "message": "service unavailable"
      }
    }
  ]
}
```

`status`, `delay`, `headers`, and `body` inherit from `baseRule`. Rule values
override base values. `headers` are shallow-merged, and object bodies are
shallow-merged; array, string, number, boolean, and null bodies replace the base
body. Use `removeBodyFields` when a rule inherits an object body but must omit
specific fields from the final response.
