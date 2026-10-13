# Review: fresh work draft confirmation after History

## Review mode and scope

- Independent Review by `/root/projection_review`; Builder `/root`.
- Deep Review under root `AGENTS.md`, Reviewer/QA/Architect role contracts, Authority
  Matrix, Business Rules and Quality Gates. No implementation changes by reviewer.
- Reviewed the candidate on `fix/charge-history-draft-confirmation`, based on
  `418cc9c5f75b7e6b82b6ab325e7f04b084d88d6c`. Initial diagnosis used `e9bda95`;
  the intervening committed delta is one QuickBooks release-evidence document and
  does not change the inspected application runtime.
- Complete candidate scope: six-line workspace diff, two browser regressions, a
  backend test for two-booking isolation, task and recovery ADR clarification.
  No backend implementation, schema, rules, configuration, authentication, payment
  execution or accounting integration changes.
- OPS-SCHED-CHARGES-001/002 remain with Office Booking Authority. Server quotes own
  pricing; confirmed work and receipts remain separate persisted records. QBO remains
  official accounting. Session recovery remains private, non-authoritative form state.

## Confirmed finding and resolution

| Severity | Location | Evidence and impact | Resolution |
| --- | --- | --- | --- |
| Medium / P2 | `apps/erp-next/components/scheduling/appointment-charges.tsx`, financial-baseline rebase effect | A newly entered work draft had `recovered=false`. Visiting History released its lease; returning acquired another lease and advanced financial version. The effect only rebased restored drafts, so unchanged work became stale and final confirmation stayed disabled. The existing test checked retained text, not ability to confirm. | Extend the exact-baseline condition to an active editing draft when the observed version increases. Preserve fresh-read, no-pending/no-busy/no-blocker checks and full financial equivalence. Reset scope and Field acknowledgments. Do not change payment-form versions. |

Independent before-fix reproduction with real components, client transport and Office
facade: enter quantity 3, confirm control initially enabled, visit History and return.
Version changed 1 to 2; quantity remained 3, confirmation was disabled, no continuation
control was present, final remained null and zero receipts were created.

Independent after-fix reproduction: enter 3 × 125, save one 250 transfer, visit History
and return. Quantity and 125 draft balance remain, scope review resets, and explicitly
reviewing again permits direct final confirmation without refreshing. Final is 375,
received is 250, final version is 4 and exactly one receipt exists.

The correction applies to other bookings using this workspace, including lease-only
reacquisition of an in-memory work draft. It does not silently adopt a changed financial
baseline, rebase an open payment form or bypass the server lease/version checks.

## Screenshot diagnosis: evidence versus inference

- Inspected supplied images `173437`, `183825` and `183840`. The last financial image
  visibly shows a 250 transfer, one current payment, no work editor/recovery banner,
  no confirmed final, pending balance and disabled PDF. It does not show a missing
  payment. Both financial screenshots use the apex origin.
- That presentation is consistent with the earlier unconfirmed work already lost
  before PR 594, or with opening the appointment without its private local draft.
  The screenshot does not establish whether work was re-entered after deployment,
  whether final confirmation was submitted, or the complete stored financial history.
- The independently confirmed History bug is distinct: it retains the visible editor
  and work but blocks confirmation. It therefore justifies this narrow correction,
  while it is not proven to be the cause of the latest screenshot.
- No production record was read or repaired by this reviewer. Do not reconstruct work
  from the receipt, infer BTU/quantities, or record the existing 250 again. Any historical
  correction must use the actual appointment identity, current history and reviewed scope.

## Isolation and persistence verification

Independent synthetic real frontend/HTTP/Office test exercised two appointments:

- Appointment A: quantity 3, one 250 receipt, final later confirmed as 375.
- Appointment B: quantity 1, one 50 receipt, final remains null.
- Switching back restores A's quantity and 125 draft balance. Each persisted receipt
  retains the correct appointment ID; neither appointment adopts the other's amounts.
- Opening A in a new tab without an opener, within the same browser context and user,
  has no local draft. It still reads the saved 250 receipt, shows no final and disables
  PDF. This reproduces the screenshot's presentation without losing server data.
- After explicitly confirming A, a fresh browser context reads final 375, received
  250 and balance 125 and enables PDF. Confirmation is server-persisted independently
  of sessionStorage.

Independent evidence directories under `/workspace/scratch/2d530acc3b67/`:

- `charge-diagnosis-independent-history/`: before-fix result and screenshot.
- `charge-diagnosis-independent-history-fixed/`: direct after-History confirmation.
- `charge-diagnosis-independent-isolation/`: two appointments, new-tab screenshot
  and fresh-browser confirmed-state result.

All writes were to isolated synthetic fixtures; external requests were blocked.
The focused tests were injected into the existing harness in memory, without changing
repository implementation or test files. They supplement the Builder's full gates.

## Final diff and gate review

- The sole runtime change broadens the existing work-draft rebase predicate and its
  effect dependencies. Full state/receipt/candidate/status baseline equality remains
  mandatory; the only excluded field remains concurrency version. Money, prices,
  identity, request replay and authority contracts are unchanged.
- Added browser coverage proves the fresh 375/250 draft remains confirmable after
  History, resets acknowledgment, survives refresh and produces its existing confirmed
  PDF. A separate same-amount foreign metadata change keeps confirmation blocked,
  retains quantity and performs zero financial writes.
- Added authority regression uses identical request IDs for two bookings, verifies
  independent receipts and replay, confirms one final and rejects a cross-booking
  void without changing stored data. It changes tests only, not backend runtime.
- `git diff --check` passes. Task/ADR describe the cause and limits consistently.
- Builder reports real browser **7/7 PASS** and charge authority **37/37 PASS**;
  reviewer inspected their local result logs. The 56-case drawer suite, ERP typecheck
  and full build were still running when this report was recorded. They remain gates,
  together with applicable CI and preview on the final frozen head.

## Decision and residual limits

**Code review PASS. Technical GO conditional on all exact-head release gates.**
No unresolved blocking finding remains in the reviewed correction. Do not merge or
publish while an applicable gate fails; preserve current main's QuickBooks changes,
validate the exact preview/source and record the post-release smoke evidence.

Unconfirmed session recovery is scoped to UID, appointment, origin and browser tab.
It is not shared server persistence: new tabs, a different origin/browser, erased
storage or explicit ordinary-draft logout may have no draft. A duplicate tab can copy
initial sessionStorage, but subsequent changes are not shared. The pending-operation
retention and exact-retry rules remain unchanged; no automatic finalization or payment
recreation is introduced.

The fix cannot recover work already discarded by the older application or prove the
production user's exact sequence. Production financial CRUD is unverified by design
here; no real data was modified. Rollback is frontend-only and must retain every saved
receipt, final snapshot and recovery copy. Deployment authority remains with the owner
authorization recorded by the release lead; this review does not grant it independently.
