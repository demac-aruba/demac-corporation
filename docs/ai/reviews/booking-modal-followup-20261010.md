# Review: Booking mode switching and compact capacity validation

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer: `/root/booking_followup_review`.
Implementation author: `/root`.
The reviewer authored regression tests and this review record only; the reviewer did not
implement the reviewed product changes or perform production writes.

## Scope reviewed

- Base: `1f1bf7783a9bf6706b8008ce0a3fa63a5c065741` (the prior released modal tree).
- User intent: return from Send van support to Regular Booking or Project without Cancel;
  keep Customer/Property/contacts left, work selection central, and work summary,
  descriptions, technician instructions and visit references right. Move capacity feedback
  immediately before Cancel while preserving every conditional authority action.
- Complete product diff: `live-appointment-create-drawer.tsx`, its scoped stylesheet,
  `adhoc-support-drawer.tsx`, `use-booking-dialog.ts`, and the owning
  `live-scheduling-overview.tsx` callbacks. Reviewed all callers, direct support entry,
  after-hours wrapper, existing source-change semantics, permission and revocation logic,
  support candidate/duration eligibility, command adapters and request recovery.
- Authority: Booking Authority remains the only appointment/capacity mutation service;
  Project Authority owns planning and links; canonical CRM/Property identity and private
  visit-reference ownership remain unchanged. Existing planned/weekly-rest/capacity-overflow
  overtime, historical acknowledgement, exact retry and temporary-hold rules still apply.

## Findings

| Severity | Location | Evidence and impact | Required correction / disposition |
| --- | --- | --- | --- |
| Medium, resolved | Support response recovery | Existing support treated a lost response as an ordinary error; adding free source switching could discard an uncertain committed support request and permit a second request. | Builder added the existing `officeBookingOutcomeUnknown` classification, in-flight guard and exact-input recovery closure. Pending/unknown support blocks editing, switching, close and Escape. Browser regression verifies identical retries and one synthetic support identity. |
| Medium, resolved | Booking/support component lifetime and dialog ownership | The old parent nulled `bookingTarget` before validating support duration, unmounting booking drafts. Keeping both components alive without activating only one focus/scroll handler would introduce competing traps or dismissals. | Builder preserves the session and validates duration before opening support. Inactive views are hidden/inert and their dialog hook is inactive. Round-trip tests cover both draft directions, one visible modal, keyboard containment and page scroll restoration. |
| Required feature-preservation check, passed | Capacity panel moved into footer | The former capacity column contained interactive support spots, support alternatives, assignment windows, overtime consent, recheck and hold guidance, not only a status label. | The original authority subtree remains in an expandable footer panel. Required choices/overtime open automatically. Tests exercise support selection, exact selected option commit, overtime consent and special mode controls. |
| Required stale-state check, passed | Compact status | Prior approved capacity may remain visible while metadata invalidates its booking offer. Green based only on that retained capacity would imply premature acceptance. | Status uses the current validated offer and remains neutral for incomplete/checking/stale/special-validation states, red on authoritative conflict, amber for overtime and green only for the current complete allocation. Regression tests cover ready → metadata change → pending → conflict → successful recheck. |
| Transitive browser interaction adaptation, reviewed; CI rerun required | Project budget, historical and planned-overtime browser scripts | Existing tests waited for detailed authority approval/conflict text that now lives inside the approved collapsed footer disclosure. | Add only waits for the appropriate status and operator-equivalent summary clicks before the original text assertions. Historical/overtime tests close the panel afterward before editing fields. All original denial, no-write, payload, retry, persisted-data, Chromium/WebKit and external-request assertions remain unchanged. |
| Transitive recovery interaction and test synchronization, reviewed; CI rerun required | Coworker-support and modal browser scripts | Coworker support's old lost-response test retried the ordinary Send button, which is intentionally replaced by exact-request recovery. A new no-Project modal case could click the old Regular control before the support activation effect completed. | Retry through `Recuperar apoyo original` while retaining all original equality/idempotency/data assertions and adding blocked-switch/close/Escape checks. The modal source helper waits for the requested visible dialog and its pressed source control after each click; no sleep, force click, scenario skip or product change. |

No unresolved product defect was found. No existing authority control, field, permission
predicate or command was removed. Regular ↔ Project continues its established source-change
reset behavior. A detour through Support back to the same booking source preserves that
source's draft; support's reason, selected appointment, duration and historical acknowledgement
also remain mounted. Switching performs no appointment, hold, support or CRM write.

## Verification

Reviewer-run evidence:

- `node --check apps/erp-next/scripts/booking-modal-browser.cjs` — PASS.
- `git diff --check` — PASS.
- Real React component browser harness: **27/27 PASS**, retaining the original 12 cases and
  adding 15 cases for this change. Final results and screenshots were captured under
  `/workspace/scratch/6e6b400440d1/booking-followup-review`.
  All non-loopback network requests are blocked; no external requests or browser JavaScript
  errors are accepted by the harness.
- Desktop 1440×1000 and 1366×768, mobile 390×844: column ordering, correct field ownership,
  viewport fit, no horizontal overflow, fixed footer, complete source accessible names,
  compact ordinary capacity, and expanded mobile capacity controls.
- Original keyboard/nested PropertyEditor and Project budget behavior; disclosure state and
  reference/contact draft preservation; mixed work/recipients payload parity; confirm and hold;
  exact lost-response retries; upload close/submit/switch protection; three-slot support.
- Regular → Support → Regular on desktop/mobile; Project → Support → Project; Support can
  switch directly to either source; no Cancel required; direct initial support entry.
- Pending confirm/hold and pending/unknown support prevent changing source and dismissing
  the session. Support retry uses the identical original payload and request ID.
- Scheduling-only Project permission and denied Project visibility stay consistent in both
  views. Ordinary support allocation remains distinct from the coworker-support write path.
- Historical support retains acknowledgement and `bookingMode: backdated`; ordinary hold
  remains separate; after-hours and weekly-rest entry keep their original restrictions and
  authoritative commit route.
- Desktop/mobile layout screenshots were inspected independently.
- Final small recovery-notice adjustment was inspected: rendering the existing authority
  error alongside the recovery instruction preserves its explanation while the capacity
  panel is absent. It adds no state, event handler or command change.
- Follow-up transitive test adaptation: `project-budget-browser.cjs` (two conflict cases),
  `backdated-project-browser.cjs` (three approval inspections) and
  `planned-overtime-browser.cjs` (one approval inspection) now open the native footer details
  through its summary. No DOM state is assigned, no assertion removed or weakened, and
  Chromium/WebKit engine loops and all scenario lists remain unchanged. Syntax checks for
  all three files and `git diff --check` pass. Their complete integration/engine runs remain
  required on the new commit in CI; inspection or syntax checks do not substitute for them.
  Builder-reported CI evidence for the original mismatch: budget run `38087952276`, job
  `114318311314` passed its first ten Chromium scenarios, then failed `availability-conflict`
  with no browser errors because the unchanged alert assertion correctly found its element
  hidden inside closed details. The visible red status confirmed the expected conflict.
- Builder-reported CI on `405253c` exposed the old coworker Send-button retry and the new
  source-helper race above, with no browser application error. The corrected tests retain
  all scenarios/engines and wait for actual visible UI state. Both scripts pass syntax and
  whitespace checks; coworker integration must rerun with its real authority fixture in CI.
  The reviewer reran the complete modal browser suite after the synchronization correction:
  **27/27 PASS**, exit 0, including the denied-Project case and every original regression.

Builder-reported transitive gates (separate from reviewer-run evidence): ERP typecheck,
production build including all existing prebuild tests, frontend dispatch/lifecycle/booking
intelligence/copilot/live-scheduling, 235 booking backend tests, 121 transactional WhatsApp
tests, and existing reference browser flows on desktop/mobile-dark with all three file types
and failure/recovery checks. Required final-commit CI still must pass; this review does not
waive or replace any gate.

Data/security review: the diff changes no Functions, transport endpoint, Firebase/Storage
rules, credentials, database schema, migration, existing Appointment/Work Order records,
customer/property records, payroll, billing or message producer. No real customer records,
appointments, support assignments, uploads or notifications were created as tests.

## Decision

- [x] Pass
- [ ] Pass with recorded follow-up
- [ ] Block / changes required

Independent product review passes. Required final-commit CI and correct live-project
deployment verification remain release responsibilities. No required gate was removed,
disabled, skipped or weakened; the existing CI automatically runs the extended harness.

Residual risk: synthetic adapters verify UI state and transport invocation, not production
backend execution. Existing backend/integration gates remain necessary. Browser verification
uses Chromium viewport simulation rather than physical devices or every browser engine.
Support duration choices, like an already-open support form, can become stale; the existing
commit-time authority revalidation remains mandatory and unchanged. No guarantee against
every future data/concurrency combination is implied. Owner: implementation maintainer.

Human approval boundary: Christian explicitly authorized this follow-up merge/deploy after
the deep audit succeeds. This review performs and approves no production data test writes,
migrations, secret/security changes or messaging.
