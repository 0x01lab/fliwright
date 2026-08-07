# Start the cloud platform with a single-tenant team queue

The first cloud-platform deployment is a self-hosted, single-tenant TeamTestQueue. Team members submit E2E test requests through an API and retrieve status and artifacts from that API; a multi-tenant managed SaaS and dashboard are later additions. This keeps device access, credentials, builds, and test data within the team's environment while validating managed execution before taking on multi-tenant isolation and operations.
