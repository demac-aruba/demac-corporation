# ADR: QuickBooks sandbox authorization boundary

- Status: Proposed (code prepared; activation and production deployment require owner approval)
- Date: 2026-10-12
- Owner: DEMAC owner / integration maintainer
- Related: issue #385; [task](../tasks/quickbooks-sandbox-connection-20261012.md); AUTHORITY_MATRIX accounting boundary; SECURITY_RULES 1–10.
- Supersedes: none. No accounting source of record changes.

## Context

The Intuit development app and a US Advanced sandbox exist. The ERP has only a placeholder.
The operator has multiple actual companies. Display names alone must not select a tenant.
ERP Next is a static export; privileged integration work belongs in Firebase Functions.

## Decision

Use one sandbox-only Function with an exact server-configured realm ID. Request only
`com.intuit.quickbooks.accounting`. This Intuit scope is not read-only; this implementation
exposes only authorization plus one sandbox CompanyInfo GET. There is no accounting write
endpoint, production API host, synchronization, report endpoint or MCP service.

An active ERP super-admin starts with a browser-generated random proof hash. The server
stores a random state hash and actor in one ten-minute pending attempt. The public callback
atomically claims state, rejects a different realm before exchanging a code, and verifies
CompanyInfo through the fixed sandbox host and configured realm. CompanyInfo.Id is an
entity identifier (often `1`), not the OAuth realm ID.

Tokens are AES-256-GCM encrypted under a managed 32-byte key with sandbox/realm associated
data. The callback stores a pending grant and returns only a fresh random completion ticket
in the fragment of an exact configured ERP URL. The ERP removes the fragment and finishes
through a fresh Firebase-authenticated POST with its retained browser proof. No callback
can activate a grant without the initiating user and browser. The callback never returns
the provider code, access token or refresh token to ERP browser code.

Transactions recheck active profile authority and fence stale attempts. Config changes
invalidate pending flows. Concurrent callback replays cannot exchange a code twice. A
completed finish can return the same safe status after a lost response without rewriting.
Failed reconnects preserve the previous connection. Provider errors are reduced to fixed
codes; request URLs, exception messages and provider response bodies are never logged by
application code. Infrastructure HTTP access logs may contain callback authorization codes;
apply the existing restricted logging policy and do not export callback URL logs.

`integrationPrivate/quickbooksSandbox` is private technical connection metadata, with a
bounded pending attempt and append-only `audit` subcollection. It is not accounting truth.
Existing Firestore default-deny rules deny direct browser access; no rules are changed.
The frontend kill switch defaults off, and isolated previews cannot contact this Function.

## Alternatives considered

| Alternative | Benefit | Reason not selected |
| --- | --- | --- |
| Tokens in browser / Next public env | Fewer server steps | Exposes accounting credentials |
| Activate on unbound public callback | Simpler redirect | Does not prove the initiating ERP browser completed the flow |
| Full invoices/payments/MCP integration now | More functionality | Requires approved identity mappings, cutoff, retries and financial acceptance beyond setup |
| Store plaintext provider tokens under Firestore encryption only | Fewer secrets | Application encryption better isolates credential disclosure from incidental document access |

## Consequences and rollout

- Stored status describes the last successful identity verification, not continuous access.
- Refresh, provider revocation UI, pending cleanup/retention automation, reconciliation and
  production grant lifecycle remain required follow-up before any financial integration.
- One ten-minute attempt per sandbox; a different admin waits until the current attempt
  completes/expires. Same admin may restart a non-exchanging attempt.
- No new dependency or domain migration. Owner approval gates secret provisioning and release.
- See [setup and recovery](../../QUICKBOOKS_SANDBOX_SETUP.md) and the separate review record.
- Revisit before enabling token use, adding a tenant/environment, changing credential keys,
  adding financial writes/reads, or exposing ChatGPT tools.
