# Independent review: appointment tab performance

## Review mode and scope

- **Independent Review** — reviewer: `/root/projection_review`; implementation: `/root`.
- Reviewed the complete working-tree diff against production baseline
  `271d0c035e43d001dc32269800a8542a6f8334dd` on
  `fix/appointment-tab-performance`, including tests and business-rule/task/ADR changes.
- Runtime scope: `appointment-charges.tsx`, its CSS, `charge-add-search.tsx`,
  `charge-catalog-picker.tsx`, and `use-appointment-charges.ts`. Also inspected the
  drawer's appointment/principal keys, dialog focus/Escape handling, the unchanged
  editing-session hook and the backend lease/version boundary.
- Applicable authorities: Office Booking Authority, OPS-SCHED-CHARGES-001/002 and
  appointment editing coordination. Prices, confirmed amounts, receipts, exact replay,
  recovery envelopes and QBO remain under their existing authorities.
- Runtime snapshot SHA-256: `90bfcefaeeb2e9cae39e3a64a8a76bd3845b8bd6c96bef344de5984d4bdad066`
  (the five runtime files above, sorted by basename, concatenating basename + NUL +
  file bytes + NUL). Review is conditional on the final release preserving this code
  or separately reviewing further runtime changes.

## Findings and resolution

| Severity | Location | Evidence and impact | Resolution |
| --- | --- | --- | --- |
| Medium, resolved | `use-appointment-charges.ts`, freshness effect | History and finance both supplied `active=true`. Removing tab-triggered lease reacquisition also removed the incidental fresh read on returning from History. An independent probe advanced time by 31 seconds and changed the synthetic received amount from 200.00 to 210.00: the earlier candidate did not read again and kept the old amount/balance visible. Expected-version checks still prevented an unsafe overwrite. | Added a view dependency to the existing stale-read effect. The independent probe now passes: same edit session, a fresh read when stale, inputs disabled while reading, then updated values. Dirty-draft suspension and the 30-second threshold remain intact. |
| Low, resolved before final verification | `charge-catalog-picker.tsx`, retained hidden panel | Keeping an open floating picker mounted could retain geometry measured while its ancestor was hidden. | An optional `active` prop closes the popup when leaving finance while retaining query and catalog. The real browser test passed hidden resize, return, reopening within the viewport, and selection without forced clicks. |

No unresolved correctness or authorization finding remains in the reviewed diff.

## Verification performed independently

**16/16 focused browser cases passed**, bundling the real React drawer/components
against an isolated synthetic authority. Existing fixtures were filtered only in an
external reviewer runner; no implementation or repository test files were edited by
the reviewer. Browser contexts blocked external requests. Production reads/writes: zero.

- Two viewports (1440 and 390): four returns each across Summary/History preserve
  description, reviewed state and an enabled final confirmation. The same financial
  version/session remains; no additional charge reads, acquisitions/releases, quotes
  or catalog reads, and no transition through a pending amount.
- Measured return latency was **82–162 ms** with synthetic delays of 1,000 ms per
  charge read, 200 ms per lease request and 600 ms per quote. These are controlled
  browser observations, not production latency guarantees.
- Reviewer-added appointment and principal replacement probes: the previous retained
  session is released with its original appointment/session identity; the new owner
  does not inherit the finance visit or payment draft; visiting finance obtains a new
  session. A reviewer-added reconciliation blocker probe releases the hidden session,
  preserves the entered payment and prevents submission.
- Payment draft and permission revocation while History is visible; late acquire
  retained across tabs; late acquire after dialog close releases only its own session.
- Unknown acquire retries reuse their session; invalid expiry fails closed; another
  operator's lease/renewal denial preserves the draft and blocks writes; hidden-document
  expiry and focus renewal continue to work; a stale pre-acquisition read cannot satisfy
  a newer fence and an expired payment draft cannot silently adopt a changed version.
- Pristine freshness on return from both Summary and History, including the independent
  before/after reproduction above. Recent snapshots and dirty drafts do not acquire
  new requests simply because the internal tab changes.
- Hidden picker resize and ordinary selection, with no catalog reread. Inspected the
  resulting 390-pixel screenshot; layout and retained draft/confirmation remain usable.
- `git diff --check` passed. Static comparison confirms no changes to functions,
  pricing/write implementations, packages/locks or authorization/rules. The local
  build-generated `next-env.d.ts`/`tsconfig.json` changes must be excluded from the
  release diff as planned; no release configuration change is part of this approval.

Reviewer evidence (scratch, synthetic data only):

- `/workspace/scratch/2d530acc3b67/tab-performance-evidence/independent/controls/results.json`
  — 13 passing cases.
- `/workspace/scratch/2d530acc3b67/tab-performance-evidence/independent/freshness-performance/results.json`
  — 3 passing cases and performance measurements.
- `/workspace/scratch/2d530acc3b67/tab-performance-evidence/independent/stale-before/`
  — failing earlier-candidate reproduction.
- `/workspace/scratch/2d530acc3b67/tab-performance-evidence/independent/run.cjs`
  — reviewer runner, added isolation/blocker/freshness probes and filtering.

## Test and compatibility assessment

The affected older tests now expire/reject a lease or close the dialog instead of
assuming an internal tab switch releases it. Their draft preservation, stale-version,
late-response and no-write assertions remain. The real-authority financial flow now
asserts unchanged version/review on an ordinary History return. Its external-evidence
conflict scenario explicitly refreshes and still rejects review/confirmation without
overwriting financial data. These changes match the requested session lifetime rather
than removing the protections under test.

The read resource remains per mounted appointment. The drawer keys the workspace by
principal and appointment; revocation/blockers disable and clean up ownership. The
existing hook still renews with server time, expires locally, and validates credentials
before writing. Internal tab navigation itself never becomes a financial mutation.

The financial subtree stays mounted under `display:none` while History is visible;
its query and local controls survive, but it is not focusable or exposed as a visible
panel. No global cache, persistent financial cache or secondary source of truth was added.

## Decision and release conditions

**GO, conditional on the complete required gates and preview passing for the exact
final head.** This review does not waive CI, type/build, real-authority finance,
recovery/balance or the full drawer suite. The Builder reports 80 drawer, 7
real-authority flows, 13 balance/PDF, 8 recovery and 7 backend editing cases passing,
plus typecheck. The final build was still running when this review closed; completed
build and exact-head CI/preview evidence must be recorded before activation.

Residual behavior is intentional and documented: after first visiting finance, an
operator reserves the appointment while its dialog remains open on any internal tab.
Other operators can read; dialog close, owner/permission change, blocker or server
expiry ends that ownership. An active unconfirmed draft still suspends background
freshness; explicit refresh and transactional version/lease checks remain necessary.
No production data or live-user contention was exercised by this review.

Release is frontend-only, with no backend/configuration/data migration. Revalidate the
production baseline and preserve any intervening unrelated changes before publication.
Rollback restores the previous frontend and retains all canonical financial data.
Production activation remains subject to the existing human approval boundary.
