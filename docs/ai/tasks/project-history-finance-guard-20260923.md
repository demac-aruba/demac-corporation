# Task: correct unexecuted historical Project slots in place

## Context

- Request/source: owner needs to correct how many Van slots were reserved for a past Project appointment, including both reductions and increases, without replacing the appointment or inventing technician hours.
- Product surface and users: authorized Project managers/operations in DEMAC ERP Next, sharing the canonical Booking Authority schedule and Project planning record.
- Current behavior/evidence: the prior cancel-and-replacement flow changes Appointment/Work Order identity, can leave Project planning counters stale, and is not the newly authorized workflow.

## Scope

- In scope: confirmed past single-Van Project appointments with no Field execution or local billing evidence; 1–6 whole slots at the original start and Van/crew; atomic Appointment, Work Order, capacity locks and Project assignment update; canonical Work Order budget projection; reason, request ID, audit, replay and explicit no-billing attestation. Old cancel/replacement records remain readable; `history_preview`/`history_confirm` can only recover an already-cancelled clean Project booking after renewed checks, not begin a new correction of a confirmed booking.
- Out of scope: regular appointments, changing date/start/Van/crew, actual labor/attendance/payroll/Field progress, invoice/payment/QBO mutations, zero slots, production migration or deployment.
- Files/boundaries expected: `functions/bookingProjectHistoricalCapacity.js` as Booking Authority owner; `projectAuthority.js` for authentication/orchestration; `projectCommercialGuard.js` for local Field/commercial gates; UI and tests.

## Governance

- Authority owner(s): Booking Authority owns Appointment/Work Order/locks and the atomic Project link participant; Project registry owns planning identity; Field owns execution; QuickBooks Online remains accounting source of record.
- Business-rule IDs: existing OPS-SCHED/OPS-TEAM and canonical Project slot budget rules. No new financial source of truth.
- Security/privacy impact: fresh role authorization, published Project claim, exact Appointment/WO/link identity, server-side transaction and default-deny client Firestore. No customer notification or new external message.
- Legacy parity impact: regular booking lifecycle remains unchanged. Existing historical correction audit/records remain readable; the legacy replacement API is a guarded recovery path for bookings already cancelled, with no new cancel/replacement UI. A preexisting Project-linked reschedule can leave Project link metadata stale; historical slot adjustment fails closed until that link is reconciled.
- ADR/debt impact: proposed in-place capacity ADR supersedes the former replacement approach for new writes. The name `scheduledFutureHours` is legacy; this operation rebuilds it from noncancelled, unposted linked Work Orders.

## Acceptance criteria

- [x] Given a clean past confirmed Project booking, changing 3→4 or 4→3 updates the same Appointment and WO, only the correct trailing locks and Project assignment, in one transaction; 08:30+4 anchors end at 14:30 while Project slots remain 4.
- [x] Given another Van/crew Work Order or ambiguous/foreign lock on added capacity, no change is written.
- [x] Given Field Visit/Office Review/actuals, local invoice/payment/Billing Candidate, inconsistent Project claim/link, or failed evidence read, no change is written.
- [x] Given an increase over the approved budget, explicit `overBudgetAcknowledged` is required and audited; the budget remains unchanged.
- [x] Every new correction requires `noBillingAcknowledged`; this is an operator attestation, not QBO verification. Local evidence still blocks.
- [x] Same `requestId`/payload replays without new writes, even after later billing; divergent reuse conflicts. Replay exposes the original `replayedEntry` separately from current canonical state.
- [x] Legacy recovery refuses a confirmed booking; an already-cancelled clean booking can be recovered only after fresh claim/Field/commercial checks, manual no-billing attestation and a reconciled Project counter.
- [ ] Isolated Firestore emulator/browser CI and independent adversarial review complete before merge.

## Plan and risk

- Implementation outline: authenticate and inspect Project candidates; on commit re-read Project, claim, Appointment, WO, all linked WOs, Field/commercial evidence, canonical locks, half-day policy and same-day work inside a Booking Authority transaction before any write. Only tail additions/removals are allowed.
- Migration/rollback or recovery: no data migration. Disable the new API and keep existing records intact if rollback is needed; retry the same request ID after an uncertain response.
- Key risks and mitigations: the external QBO source is not queried; owner states billing is not active currently and requires explicit per-correction no-billing attestation. A future QBO integration must replace/augment this manual control before assuming external financial reconciliation. Existing Field work requires separate governed reconciliation rather than slot-only edit.

## Verification

- Automated gates: `node --test bookingProjectHistoricalCapacity.test.js`, full Booking Authority regression, `npm run validate:firebase`, isolated Firestore emulator and ERP browser acceptance in CI, ERP typecheck/build.
- Manual scenarios: no production records used or changed.
- Evidence/results: focused synthetic tests pass locally; complete gate status recorded in review handoff/CI when available.
- Not run and why: isolated emulator is unavailable on this Windows host without Java; production smoke/deploy are outside this branch task and require human approval.
