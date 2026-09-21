# ADR-PROJECTS-001: central planning, canonical execution, recover first

## Status

Proposed target architecture; implementation authorized on an isolated branch. Production
activation, new source-of-record rollout and migration require explicit owner approval.
The first increment implements recovery and read-only diagnostics only, not a registry.

## Context and evidence

- Active UI: `apps/erp-next/components/projects/projects-phase-workspace-v2.tsx`.
- Browser persistence: `apps/erp-next/lib/project-record-sanitizer.ts` and `browser-projects.ts`.
- Link after canonical confirmation: `components/scheduling/live-appointment-create-drawer.tsx`.
- Real scheduling duration/slots: `functions/bookingAuthorityWorkOrders.js`.
- Actual visit identity/lifecycle: `functions/fieldOperationsAuthorityWorkVisit.js`.

Local Project records cannot serve as shared operational truth. A live appointment may
survive a failed browser-only link. The Field Visit model exposes timestamps, but subtracting
start from completion ignores pauses/restarts and is not a reliable labor ledger. Local
assignment hours and phase-preview reports are not canonical field evidence.

## Decision

Keep domain validation, authenticated service commands, persistence adapters and presentation
separate. Reuse the existing authority of each domain; do not create another scheduling,
work-visit, inventory or accounting system.

Target central planning records will own Project scope, budget, phases, dependencies and
criteria only. Project-to-Work-Order links will reference existing identities, be unique per
Work Order and retain audit/provenance. Actual hours, execution state and costs are read
projections from existing authorities, never mutable totals accepted from a browser backup.
The precise write schema and activation controls must be reviewed in the persistence slice.

Backend writes must authenticate current provisioned roles, revalidate entity identities,
check optimistic versions, use deterministic exact-payload retry keys, and commit audit with
the mutation. Conflicts are explicit; no last-write-wins replacement of a whole local Project.
Avoid dual writes where appointment success depends on local storage. Existing Booking Authority
must continue to decide capacity; failures in reporting must never duplicate a booking.

A historical local link is a reconciliation candidate, not proof of project association.
Check canonical Customer/Property/Appointment/Work Order IDs. A related support Work Order
without its own explicit link is listed for review rather than silently charged to a phase.
General Project Work is retained even when phases were created afterwards.

Never equate planned slots, planned service duration, physical progress, crew/site hours,
person-hours or payroll. Unknown/unreconciled actuals are null, not zero. Physical progress
needs an approved units/checklist/milestone rule independent of spending the time budget.
The current diagnostic therefore reports observed allocation and visit evidence but deliberately
does not manufacture actual labor hours or a completion percentage.

## Recovery boundary

Export only Projects and company phase templates as raw strings, with origin/time and SHA-256.
Preserve unknown/malformed content and IDs. Validate the saved file locally. No cloud backup,
restoration or migration is implied. A preview browser origin has separate storage; export from
the original origin/profile or use an inspected read-only helper there.

`functions/projects/reconciliation-reader.js` is server-internal, not exported by Functions.
It uses a read-only transaction, revoked-token-aware verification, a provisioned owner check,
exact scoped reads and bounded queries. Truncation/conflicts block aggregates. It initializes
no Firebase SDK, exports no endpoint, changes no rules and performs no writes.

The first UI is isolated at `/projects/recovery`; it does not load the existing planner or
sanitizer. Existing `/projects` behavior, Scheduling and Field execution are unchanged.

## Consequences and alternatives

A phased rollout is slower to appear complete but avoids corrupting live history or hiding
unknown values behind zeros. Rejected: increasing actual hours when slots are booked; copying
preview completions into Field; joining by customer name; reading entire operational collections;
blindly restoring local JSON; deploying first and reconciling later.

Before activation: verified backup/restore exercise, real read-only reconciliation, import
preview with collisions/orphans, authentication/rules emulator tests, retry/concurrency tests,
Chromium/WebKit/mobile acceptance, full affected CI, rollback/forward-recovery rehearsal and
explicit owner approval. Do not treat this ADR as evidence those gates passed.

## Primary engineering references

- https://firebase.google.com/docs/firestore/manage-data/transactions
  Transaction callbacks may retry; all reads precede writes and commits are atomic.
- https://firebase.google.com/docs/functions/firestore-events
  Events may repeat or arrive out of order; future projections must be idempotent.
- https://googleapis.dev/nodejs/firestore/latest/Firestore_.html
  Read-only transactions support consistent scoped snapshots without write locks.

These references guide implementation; they do not authorize production changes.
