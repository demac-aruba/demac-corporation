# Task: Assign Projects from Book Overtime

## Context and scope

- Christian's 1 October 2026 screenshots show Van 4's weekly afternoon rest and a
  Book Overtime drawer that offers services but no Project source.
- Weekly-rest mode excluded Project loading, selection and submission; the special
  booking backend also omitted canonical Project links.
- In scope: existing published Projects, phase selection, whole planned slots,
  budget warning, overtime consent, atomic links and exact retry recovery.
- Out of scope: open-ended emergencies, ordinary afternoon overflow Projects,
  historical Project corrections, schedule configuration and actual payroll.

## Governance and implementation

- Deep Review: this extends the existing reservation transaction to its existing
  Project link participant. Booking Authority retains Appointment, Work Order and
  capacity ownership; projectRecords retains planning ownership.
- Rules: OPS-SCHED-PLANNED-OT-002 and canonical Project scheduling authorization.
- Reuse withProjectBookingLinks for fresh role, version, phase, CRM, state and
  link-limit validation, transactional claim and assignment write. No new authority,
  collection, security rule or migration. No new architecture decision is needed.
- Include normalized Project identity/version in the existing consent fingerprint.
  Existing bookings without a Project retain the same fingerprint representation.
- Replay checks permission, preserves the original request and never increments the
  Project twice. Client confirmation verifies returned Project/phase linkage.
- Draft browser-only Projects must be published first; no non-atomic preview link
  fallback in this overtime path. Existing ordinary preview behavior is unchanged.

## Acceptance criteria

- Any eligible Van/date weekly rest booking shows Regular Booking / Project for a
  permitted operator; the Project provides canonical customer/property and phase.
- Selected slots and overtime metadata persist with the Appointment, Work Order,
  locks, Project assignment and claim in one transaction.
- Budget and overtime warnings are separate. Cancelling either writes nothing.
- Stale Project/phase/CRM data, permission loss, occupied intervals, unavailable
  crew and invalid consent reject without partial writes.
- Same-request retries create one link; competing requests cannot double reserve.
- Reloaded Scheduling displays the Project label and overtime booking.

## Verification and rollout

- Focused facade/after-hours/Project authorization tests, real Firestore emulator
  concurrent tests, integrated browser flow, TypeScript, Firebase syntax and ERP
  build. Final results recorded in the separate review.
- Deploy officeBookingAuthority before the frontend after human approval. No data
  backfill. Roll back frontend first if needed; retain linked bookings and use the
  existing supported lifecycle for any intentional cancellation.
