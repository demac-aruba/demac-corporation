# Task: Read-only QuickBooks sandbox reports

## Context and scope

Owner Christian completed the sandbox OAuth round trip at 18:58 Aruba on 2026-10-12.
The ERP screenshot showed `Sandbox autorizado`, realm `9341458478454738`,
Advanced Sandbox Company US c251. At 19:00 he asked to continue the proposed next
block: renewable access and sandbox reports. This is Deep Review because encrypted
credentials, concurrency and access to accounting reports are involved.

Implement on-demand ProfitAndLoss, BalanceSheet and AgedReceivables reads in the
existing QuickBooks sandbox function/card. No production-company connection,
financial writes, synchronization, bank access, MCP or ChatGPT access is included.
The prior sandbox deployment approval applies to this bounded connection work;
no production credentials, IAM/rules changes or operational data migration is needed.

## Authority and rules

QuickBooks remains accounting authority; returned values are projected, never
recalculated or persisted as ERP accounting balances. Only the existing active
owner/admin service boundary may query. `FIN-QBO-SANDBOX-READ-001` describes this
owner-requested read-only sandbox behavior. Legacy, scheduling, pricing and payment
workflows have no changed callers. `integrationPrivate/quickbooksSandbox` retains
encrypted credentials/coordination metadata and metadata-only audit events.

## Acceptance and recovery

- Three fixed sandbox GET report paths; reject custom tenant, URL, query, name or dates.
- Maximum 366-day range, 2 MiB response, 24 columns, 2,000 projected rows and depth 12.
- Show source currency, actual report basis, period, company and retrieval timestamp.
  Preserve original strings and section totals. Explicit no-data; malformed or
  mismatched responses fail without guessed balances or silent truncation.
- Refresh on demand before expiry. A 90-second transactional lease serializes reports
  and excludes OAuth handshakes. Persist newest encrypted token before report access.
- A persisted uncertainty marker prevents replay after interrupted refresh. Explicit
  reauthorization recovers; no unattended refresh scheduler is added.
- Current role is checked before calls and before disclosure. Revocation during a
  refresh still saves the rotated credential, but denies accounting data to the actor.
- Browser data remains in component memory, clears on filter/session changes, and
  isolated previews cannot reach the backend. No automatic report on page load.
- Deployment updates only the exact reviewed existing sandbox revision, preserves its
  configuration and other Functions, then verifies published source and HTTP boundaries.
  Rollback to reviewed prior function/frontend disables reporting, retains compatible
  encrypted grants, and performs no accounting or operational migration.

Verification and residual gaps are recorded in the companion review. Owner comparison
against actual sandbox reports remains a distinct acceptance step after release.
