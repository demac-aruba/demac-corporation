# Review: weekly-rest appointment moves

## Review mode and scope

Solo Maintainer Adversarial Review. Codex implemented the change and then separately
reviewed the complete diff, direct candidate/render/transport/projection callers,
office facade, canonical move transaction, consent calculation and capacity locks.
This is not an independent review. Source: Christian's 3 October 2026 request;
rule OPS-SCHED-MOVE-REST-001; Booking Authority remains the only write authority.

## Findings resolved

- Both the candidate filter and OFF-slot renderer excluded the requested destination.
  Weekly-rest targets now require server preparation and explicit rest/overtime consent.
- Same-Van weekly-rest moves need the existing atomic swap, without enabling ordinary
  same-Van overflow or automated availability. The new exception is bounded accordingly.
- Refresh previously reconstructed owned slots only inside the ordinary half-day.
  Accepted rest moves now reconstruct every continuous reserved slot and retain their
  weekly-rest label, including the fourth slot after ordinary closing.
- Consent now also binds the dated recurring schedule. Changed crew/scope/schedule,
  reservations or work after preparation reject confirmation without releasing source locks.
- Existing four-slot morning half-day work was incorrectly projected onto the 13:30
  capacity anchor in the move conflict check. Use that Van's canonical half-day grid
  so its 11:30 fourth slot cannot block an otherwise free afternoon. The real emulator
  race remains at 13:30 and proves one winner while preserving the losing appointment.
- The former test allowing a weekly-rest move on a Van under maintenance contradicted
  the requested confirmed exception. Replaced its success assertions with rejection
  and preservation assertions; no permission/conflict check was weakened.

## Verification

| Gate | Result |
| --- | --- |
| ERP Next typecheck (original tracked tsconfig) | PASS |
| Firebase syntax gate plus changed move modules | PASS |
| Operational move + Office facade partial/Project tests | PASS: 41 tests, zero skipped |
| Live scheduling / Saturday drag / attribution / cards / Project labels | PASS, including every Van, same-Van rest and refreshed four-slot capacity |
| ERP Next production build and all prebuild gates | PASS with synthetic Firebase public config |
| Real Firestore emulator move suite | PASS: 10 tests, zero skipped |
| Chromium with real React, office facade and loopback Firestore | PASS: all-Van rest targets; cancel/Escape/backdrop; double-submit; four-slot same-Van persistence; reload; conflict after preparation |
| Browser page errors / external requests | Zero / zero |
| git diff --check | PASS |

Emulator checks include unauthenticated/technician denial, exact/concurrent retries,
two appointments racing one destination, normal-booking and after-hours races,
complete lock retention/release, late conflicts, and unchanged timesheets/queues.
Screenshots in ../evidence/weekly-rest-moves/ were visually inspected.

Initial validation harness issues were resolved without disabling gates: run emulator
and client in the same execution network namespace; use the existing loopback request
interceptor with the demo-overtime build (the unrelated isolated-preview flag is for
demo-dwellings); wait for the actual confirmation response before asserting persisted
state because the dialog hides while saving. The final commands above pass.

## Decision and residual risk

No unresolved finding in this scoped review. No production data or environment was
modified. No new collection, permission, payroll source, migration or ADR is needed.
Multi-Van/support coordination and historical/executed work retain existing boundaries.
GitHub checks must also pass before merge. Deploy officeBookingAuthority before the
frontend, with explicit owner approval as required by AGENTS.md. Rollback reverts the
feature without deleting appointments, reservations or audit history. Owner validation
and production smoke remain post-approval activities.
