# Appointment detail premium presentation — 2026-10-10

## Task and approval

The owner approved the DEMAC appointment-detail mockup, then explicitly requested
merge and production deployment faithful to that image. This is the UI follow-up
to appointment charges (#563) and preserves booking navigation/capacity changes
in #564. Builder: `/root`. Review mode: independent Deep Review, continuing the
owner's workflow/data-preservation audit request. Reviewer: `/root/financial_review`.
Base: `a5eb74db8b68bab8d33a9b47b65b9f0bdf3279c2`.

## Scope and acceptance

- [x] Two-column overview: work/references and customer/communication; DEMAC blue,
  violet notes, green WhatsApp, outlined icons, customer initials and persistent actions.
- [x] Technical/capacity, access/contact and recipient detail remain accessible through
  disclosures. Booking audit moves into History above the existing financial history.
- [x] Preserve charge/history draft identity, reference notes/GPS/media drafts, command
  routing, holds, partial work, support, Projects, cancellation and historical correction.
- [x] Loading/error states do not hide base appointment information. In-flight reference
  uploads/saves and communication writes block dismiss/navigation until completion.
- [x] Desktop, short laptop and mobile fit without horizontal overflow; modal focus stays
  contained, and Escape remains blocked during pending writes.
- [x] Existing booking/reference consumers retain their default presentation contract.

## Authority, rules and security

Booking Authority continues to own Appointment/Work Order identity, availability,
capacity locks and lifecycle transitions (`OPS-SCHED-*`, `OPS-SVC-*`). Existing
reference APIs own private media, version checks, stable retry requests and audit
(`OPS-SCHED-REFERENCES-001`). Existing communication authority and shared WhatsApp
queue own per-recipient policy and actual delivery; the new summary aggregates
returned states and never fabricates successful delivery. The mockup's global
communications switch is represented by a read-only status because the real supported
mutation remains per-recipient. Manual delivery evidence remains visible.

`OPS-SCHED-CHARGES-001` stays in the existing financial workspace and authority;
this PR does not edit their calculations, records, API, permissions or source of truth.
Opening the drawer is read-only. Existing appointments need no backfill or migration.
No backend, Firestore/Storage rules, credential, catalog, customer, accounting or Field
schema changes. This is presentation and local component-state coordination only;
UI visibility does not replace server authorization. No new architecture decision or
source of truth is introduced; existing authority decisions continue to apply.

## Independent findings and corrections

| Severity | Evidence / impact | Correction and verification |
| --- | --- | --- |
| High | Different financial workspace keys/positions during charges/history switching could discard unsaved edits. | One keyed workspace at the same tree position; browser assertion preserves draft both directions. |
| High | New slot pluralization dereferenced a missing primary assignment on legacy records. | Guarded primary slot count reused; empty-assignment browser case passes. |
| Medium | Overview refactoring initially exposed edit/reschedule/cancel for partial outcomes. | Original partial-only follow-up/review behavior retained; scheduled and pending cases pass. |
| Low | Compact communication omitted the manual-send audit clue. | Manual marker restored in recipient disclosure and asserted. |
| Low | Agenda-wide !important text rules shrank premium typography. | Local overview/header/footer overrides; actual component screenshots inspected at three viewport sizes. |

All findings are resolved. Independent reviewer inspected the owning components,
shared default consumers, authority call sites and final screenshot. No remaining
blocking finding in the UI scope.

## Verification and boundaries

- ERP TypeScript check and production build: PASS.
- New real-component browser suite: 17/17 PASS; 1440×1000, 1366×768 and 390×844.
  Includes no-write opening, disclosures, financial mount identity, reference drafts,
  upload preview/order/removal, exact retry ID/version, pending-write locks,
  communication mixed-state summary/policy/manual-send routing, edit/reschedule/outcome
  hand-off, cancel payload, hold confirmation, partial/readonly/cancelled/legacy guards,
  support/Project/historical distinctions, supplemental load failure and keyboard focus.
- Independent reviewer reran the new 17 cases and the existing reference browser suite
  (desktop/mobile; uploads, reader, save/load recovery): PASS.
- Existing full booking-modal browser suite: PASS; CI includes it alongside
  the new detail suite. CI retains synthetic screenshots/results as workflow artifacts.
- Browser adapters are synthetic and block external traffic: zero external requests,
  real messages, production customer mutations or production financial writes. The detail,
  reference and communication components are real. Unchanged lifecycle editors and the
  financial workspace are delegation/state probes in this new suite; their existing
  domain/financial/booking suites remain in place. This is not a claim of live-data E2E.
- Production build and all workflows must pass on the exact release head. PR records
  the final CI/deployment IDs and frontend HTTP smoke. No check may be bypassed.

## Release and recovery

Decision: PASS for UI scope, subject to exact-head CI/build and frontend deployment
verification. Human merge/deploy approval is already recorded in the owner request.
Merge with `[merge-only]`, then explicitly deploy only `demac-corporation-web` to
`demac-aruba.com`. Verify merged tree equals tested tree before deployment.
No backend deployment or data migration is necessary. Rollback is redeploying the
previous frontend; existing canonical data remains readable by both versions.

Residual limit: browser fixtures verify UI behavior against deterministic adapters;
production write smoke is deliberately not performed on real customer appointments.
Expanded disclosures/large media lists scroll inside the modal; footer remains fixed.
Owner for any subsequent visual iteration: ERP Scheduling maintainer.
