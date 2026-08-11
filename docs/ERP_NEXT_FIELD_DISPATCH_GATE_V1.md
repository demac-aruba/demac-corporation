# ERP Next — Field Dispatch Gate V1

## Objective

Use consolidated Work Order readiness to control the transition into Field Execution while keeping pre-dispatch authority separate from work that has already started.

## Requirements

- FIELD-GATE-001 — Field uses the same READY / AT RISK / BLOCKED calculation as Work Orders and Command Center.
- FIELD-GATE-002 — READY may start normally.
- FIELD-GATE-003 — AT RISK requires an explicit Operations release before start.
- FIELD-GATE-004 — BLOCKED has no Field-side release and cannot start.
- FIELD-GATE-005 — AT RISK release records Work Order, current risk signature, reason, authorizer and timestamp.
- FIELD-GATE-006 — A release is valid only while the current risk signature still matches.
- FIELD-GATE-007 — Changes to the risk set invalidate the older release automatically.
- FIELD-GATE-008 — The technician Field UI consumes release authority but cannot create it.
- FIELD-GATE-009 — Exact HVAC Scope remains mandatory before start.
- FIELD-GATE-010 — Field evidence, add-ons, voice and summary stay read-only until Start Work is recorded.
- FIELD-GATE-011 — Start Work records/retains startedAt and changes execution to in_progress.
- FIELD-GATE-012 — Readiness controls the start decision; later readiness changes do not erase an already-recorded physical start.
- FIELD-GATE-013 — After start, Field remains editable until technician submission or Office Review lock.
- FIELD-GATE-014 — Submission requires active in_progress state plus the existing evidence/scope/voice gates.
- FIELD-GATE-015 — Pending or Approved Office Review locks Field edits.
- FIELD-GATE-016 — Returned reports can reopen the same Field Execution for correction.
- FIELD-GATE-017 — Approved reports require a future governed revision workflow rather than silent reopening.

## AT RISK release semantics

A release does not change the underlying readiness status to READY. It records that Operations reviewed the currently known risks and authorized the job to begin with those risks still visible.

The release stores a signature derived from the current AT RISK dimensions and reasons. If that risk evidence changes, the release no longer matches and another Operations decision is required.

## Browser persistence

`demac.erp-next.operations.dispatch-at-risk-releases.v1`

## Production migration

Production release authority should require an authenticated Operations/Manager capability, durable server timestamp, append-only audit evidence and a transactional check that the risk signature has not changed between review and release.