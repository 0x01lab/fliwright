# Require explicit E2E side-effect authorization

E2EAgentMode may autonomously inspect the app, interact with test accounts, use declared mocks, capture artifacts, assert outcomes, and retry. It must block payments, orders, outbound messages, and production-data mutations unless the TestPlan explicitly authorizes that effect; the authorization is retained in the resulting Trace. This preserves a single safety model for local agents, CI, and future cloud execution.
