# Worker one-time pairing

Cloud administrators create a pairing for a unique Worker ID in the Workers page.
Cloud shows a random 80-bit code once, valid for ten minutes. An administrator can
cancel a pending pairing or revoke a completed pairing. No static server config or
restart is needed. New hosts have no execution slots or project access until enrolled.

`POST /api/worker-pairings` creates a code; authenticated admin GET/DELETE routes
inspect or revoke the pairing. `POST /api/worker/pair` exchanges the code once for
a 256-bit host credential. Store only code/credential SHA-256 digests in SQLite;
redemption, host registration and credential creation are atomic. Expired, consumed
and revoked codes receive the same error. Public redemption is rate limited.
Credentials survive Cloud restarts, authenticate both WSS and publication HTTP, and
cannot access browser/admin APIs. Revocation closes active WSS connections.

`fliwright-worker pair <server-url> <new-directory>` prompts for the code on
stdin, exchanges it over HTTPS (HTTP allowed only for loopback development), then
writes a private credentials file and discovery config. The destination must not
exist; reserve it with mode 0700 before redemption, files are 0600. Never print
credentials or put the pairing code in process arguments. The saved config can be
used immediately by `discover`; executor settings are added for `run` later.
If a redemption response is lost or local persistence fails, revoke that pairing
and create another; never retry a potentially consumed code automatically.

Worker auth config accepts exactly one of `tokenEnv` (managed environment secret)
or an absolute `credentialFile` (paired host). Executor allowlisted environment
never includes the service token. Pairing HTTP requests refuse redirects.
