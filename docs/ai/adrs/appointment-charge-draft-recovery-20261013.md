# ADR: recover unconfirmed actual-work inputs and uncertain requests

- Status: Accepted; corrective implementation within Christian's authorized audited release.
- Refines OPS-SCHED-CHARGES-001/002 and appointment-charge-balance-pdf-20261013.
- Authority: Office Booking Authority remains the operational financial writer; QBO
  remains official accounting. Browser recovery is disposable form state, not a ledger.

## Evidence and decision
The owner entered three 125 AWG services and a 250 AWG receipt, then refreshed before
confirming the actual-work total. The receipt was persisted; React-only lines disappeared.
The preceding regression confirmed before refresh, so it did not cover this sequence.

Keep bounded, schema-validated inputs and notes in sessionStorage keyed by authenticated
UID and appointment. Load only after a fresh authorized read by an allowed manager.
Restore no quoted total, scope acknowledgment or Field reconciliation acknowledgment as
authority. Requote current inputs. Compare the full stored financial snapshot, receipts
and Field fingerprint; exclude only the lease-fencing version. Financial changes require
explicit review tied to the exact observed baseline. Lease-only changes can safely rebase.
A known own write advances the baseline only after its matching fresh server version.

Persist each monetary request before dispatch. The retained edit token belongs only to
that immutable replay payload; every activation acquires a new edit-session identity.
No auto retry or background monetary commit occurs. Authentication invalidation and
reauthentication retain copies. Explicit logout removes ordinary drafts; pending or
unparseable copies remain scoped to their original UID until exact resolution or explicit
reconciliation. Another authenticated user cannot load/replay that envelope.

A rejection of a retry does not prove the first uncertain attempt failed. Retain it on
unknown/auth failures. A definitive charge_edit_lost/charge_conflict can resolve it only
when, before that retry, this client owned a different newly acquired lease and had observed
an appointment version greater than the pending request's expected version. That durable
appointment write fences old in-flight transactions. The authority then checks the exact
audit replay before lease/version checks, proving non-commit in this narrowly defined case.
Expiry alone, same-session leases and idempotency conflicts never provide this proof.

## User behavior and boundaries
- Compact status distinguishes private recovered draft from confirmed work and receipt.
- A saved receipt never implicitly confirms the work; the final scope review stays explicit.
- Ordinary close/reopen preserves recovered inputs. All drawer exit paths guard a payment
  form or failed recovery storage; beforeunload warns while work/payment/uncertainty remains.
- Unknown requests block dependent monetary actions; acquiring a fresh lease is allowed
  to recover safely. Failed storage prevents sending an operation without replay recovery.
- Explicit discard confirms loss of draft inputs, preserves server receipts, and cannot
  discard unresolved monetary requests. Unreadable copies require explicit reconciliation.
- Recovery survives refresh in the same tab/session, not another device or erased browser
  storage. Previously discarded old-version inputs cannot be fabricated or backfilled.
- The existing PDF exports only a freshly read confirmed final and saved receipts.

## Validation and rollback
Real component/transport/Office facade flows run with synthetic transactional storage and
blocked external requests. Verify 375/250/125 before final confirmation, refresh, recovery,
explicit final confirmation and PDF; failed acknowledgments, auth denial, identity isolation,
expiry versus fresh fencing, stale review, quota/corruption and every drawer close path.
Retain existing auth, scheduling, financial and responsive gates. No backend/schema/rules,
production data migration, customer messaging or dependency changes.

Rollback only the frontend deployment to the prior reviewed production deployment.
Keep every real receipt/final snapshot created during operation. Session copies are ignored
by the prior version; resolve pending operations and preserve drafts before a rollback when
possible. Do not clear browser storage or recreate payments as a rollback procedure.
