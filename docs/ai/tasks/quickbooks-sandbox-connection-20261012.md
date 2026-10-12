# Task: verify the QuickBooks sandbox connection

## Context

- Request/source: Christian's 2026-10-12 continuation of the ERP / QuickBooks setup; issue #385.
- Surface: ERP Next Integrations, active owner / super-admin accounts.
- Evidence: QuickBooks is a static Pending card; Intuit development app and US Advanced sandbox exist.
- Mode: Deep Review (OAuth, credentials). Feature branch; no deployment authority inferred.

## Scope

- In: sandbox-only OAuth, deterministic realm allowlist, CompanyInfo verification, encrypted server-side credentials, administrator status card.
- Out: production QuickBooks, transaction writes, catalog/history import, token refresh workers, reports, ChatGPT/MCP, financial audit claims.
- Boundaries: `functions/quickbooks*`, ERP integration card/client, bootstrap export, focused tests and documentation.

## Governance

- Authority: QuickBooks retains accounting truth; Firebase Functions owns provider credentials and integration execution. Existing `users` profiles own ERP authorization.
- Rules: AUTHORITY_MATRIX accounting boundary; SECURITY_RULES 1–10; SCALABILITY_RULES 1–9. `OPS-SCHED-CHARGES-001` and operational receipts remain unchanged.
- New records are private integration metadata, not a new domain ledger or customer/catalog authority. Existing default-deny Firestore rules remain unchanged.
- Legacy parity: N/A, new ERP capability. ADR: proposed sandbox handshake contract.

## Acceptance criteria

- [x] Only an active provisioned admin/owner can start, finish or read connection status.
- [x] Authorization is bound to the initiating ERP user and a browser-generated proof; state and completion ticket are one use and expire.
- [x] A different realm is rejected before token exchange; only sandbox CompanyInfo is read.
- [x] No access/refresh tokens reach browser, logs or source. Stored credentials are authenticated-encrypted with a managed key.
- [x] Concurrent/replayed/stale callbacks cannot overwrite the current connection; finish retries are idempotent.
- [x] Missing configuration, provider failure and cancellation are recoverable and do not fabricate a connection.
- [x] UI says sandbox authorization / last verification, explicitly no synchronization; real DEMAC remains unconnected.
- [x] Audit records identify actor, action, realm, correlation, time and outcome without credentials.

## Plan and risk

- Start -> Intuit -> backend callback verifies CompanyInfo -> browser-bound authenticated finish -> persisted connection snapshot.
- Single private connection document and one bounded pending attempt; append-only audit records. No migration.
- Recovery: retry setup after cancellation/failed or expired attempts; never retry a consumed authorization code. Kill switch disables all provider use. Existing credentials survive failed reconnects.
- Lost callback/exchange response may require fresh authorization. Revocation and refresh are explicitly deferred; stored status is historical verification, not continuous health.
- Expected volume: one owner, fewer than 10 setup attempts/day; burst ceiling 10 function instances. Provider calls limited to one exchange and one CompanyInfo read per claimed attempt, each with a 12-second timeout. Operations owner reviews setup errors before expansion.

## Verification

- Functions syntax gate plus focused OAuth, permission, concurrency, encryption and failure tests.
- ERP typecheck, focused client tests, mandatory build and prebuild tests.
- Separate Solo Maintainer Adversarial Review; no independent reviewer claimed.
- Real Intuit round trip and approved deployment remain pending credentials and explicit release approval.
