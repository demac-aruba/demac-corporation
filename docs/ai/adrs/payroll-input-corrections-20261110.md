# ADR: retain payroll inputs with atomic correction history

- Status: Proposed for release
- Date: 2026-11-10
- Owner: DEMAC payroll; implementation/review: Codex
- Rule: OPS-STAFF-INPUT-CORRECTIONS

## Decision

Keep the existing advance documents and bonus adjustment array. An operator edits an
existing record or logically deletes it. Employee identity and creation metadata remain
unchanged. Every correction appends reason, authenticated UI principal UID/name, Aruba-
displayed timestamp and before/after business values. The writer atomically commits input
and history through the existing web batchGet/commit helper with a version precondition.
Retries reread and revalidate the target, preserving independent settings/adjustment edits;
changed target or history fails closed. Exact committed requests return current state.

No new collection, server authority, security-rule change, automatic payroll calculation,
QBO send, migration or production data operation. Physical deletion was rejected because
it loses the requested audit. Moving bonuses between employees was excluded because it
requires a separate two-owner command; correct a wrong employee by deleting/re-entering.

## Evidence and consequences

The initial inherited PATCH helper failed the real emulator version precondition (required
version zero despite a valid read timestamp). Correction writes therefore reuse the
already-established atomic web commit transport; no precondition was removed or relaxed.
The old bonus creation path is unchanged. Auth/Rules emulator tests validate actual access
and revocation, while domain/browser tests validate audit, stale writes, replay and exports.

Existing active admin/accounting writers remain trusted under payrollRole. This does not
claim server-enforced immutable audit or defend against a privileged actor rewriting the
whole legacy document outside this editor. Inline history shares the existing Firestore
size limit; exhaustion rejects the entire write rather than discarding history. Old Legacy
unconditional array writers remain a known compatibility limitation.

Deployment is frontend-only after approval. No backfill. Rollback must retain void filtering
for advances; reverting to old readers would count logically deleted advances again. Any
production correction is a forward audited change, never a history rewrite. Review this
boundary before adding locked payroll, cross-employee transfers or untrusted integrations.
