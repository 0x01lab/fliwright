# Fliwright Security Model

Fliwright is local development and test infrastructure for applications whose
source and debug build you control. It is not a remote device-management
service and must not be exposed as a production control plane.

## Trust boundary

The Dart bridge can inspect widget semantics, capture screenshots, synthesize
input, reset application state, and configure mocks. Anyone who can reach the
app's Dart VM Service can potentially invoke powerful debug behavior. Treat the
VM Service URL and the machine running the app as trusted test infrastructure.

The optional MCP server runs over stdio and has the permissions of its host
process. It does not provide an authentication layer around Fliwright. Configure
it only in trusted coding-agent hosts and expose the smallest suitable tool
profile; `core` is the default.

## Safe deployment rules

- Initialize `FliwrightBridge` only from a dedicated debug/profile or test
  entrypoint. Never make that entrypoint the production launch target.
- Keep the Dart VM Service bound to a trusted local or isolated CI environment;
  do not publish its endpoint through a public tunnel.
- Keep the default MCP `core` profile unless a bounded task requires
  `development`, `tdd`, or `flow`. Use `full` only for migration or specialist
  debugging.
- Store only synthetic or redacted data under `.fliwright/`. Screenshots,
  widget trees, mock calls, logs, and run reports can contain personal data,
  access tokens, or application secrets.
- Do not commit VM Service URLs, device configuration, run artifacts, or
  credentials. Apply normal CI retention and access policies to exported
  artifacts.
- Review generated or AI-proposed test changes before merging them. MCP access
  does not turn generated code into a trusted security boundary.

## Release-build behavior

`FliwrightBridge.init()` and `initForDioMock()` return immediately when Flutter
reports release mode. In that mode they do not register VM Service extensions,
start the loopback mock server, or install HTTP overrides. A separate test
entrypoint is still required so release tree shaking can remove test-only code
and dependencies; the runtime guard is defense in depth, not permission to
ship the automation entrypoint.

## Network behavior

The bridge mock server binds to IPv4 loopback. The TypeScript runtime connects
to the explicitly supplied or locally discovered Dart VM Service endpoint.
Optional AI adapters, Figma integration, or application-owned plugins may add
their own network behavior and should be reviewed separately before use.
