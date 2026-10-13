# Review: actual-work draft and uncertain payment recovery

## Review mode and scope

- Independent Review by `/root/projection_review`; implementation by `/root`.
- Reviewed the complete uncommitted candidate on `fix/charge-draft-recovery`, based
  on `f4c519ff`, including the final auth/retry corrections and synchronized replay
  regression. This report changes no implementation.
- Applied root `AGENTS.md` Deep Review, Reviewer/QA/Architect lenses, Authority
  Matrix, Business Rules and Quality Gates. Scope is the recovery module, financial
  workspace and drawer callers, AuthProvider sign-out, Office error classification,
  associated tests, task, ADR and business-rule update.
- Inspected existing lease acquisition/renewal, authorized read/quote, monetary
  transaction and audit replay dependencies. No backend, schema, rules, dependencies,
  production configuration, invoice issuance or QBO write changes are required.
- OPS-SCHED-CHARGES-001/002 remain owned by Office Booking Authority. Pricing
  Authority supplies fresh quotes; browser recovery is private form state, not a
  ledger or a second financial source of truth.

## Incident and resolved findings

The reported sequence was previously untested: enter three 125 AWG services, record
250 AWG, then refresh **before** confirming the final scope. React-only work inputs
disappeared while the independently committed receipt remained. The previous test
confirmed work before refreshing and therefore did not detect the incident.

| Severity | Location | Evidence and impact | Resolution verified |
| --- | --- | --- | --- |
| Medium | `appointment-charges.tsx`, recovery review | A boolean review checkbox survived a second foreign financial change and could accept a snapshot the operator had not reviewed. | Acceptance is bound to the full current financial baseline; render and continuation handler require the same baseline. A second refresh clears effective acceptance. |
| Medium | `live-appointment-details-drawer.tsx`, lifecycle callbacks | Edit/outcome/reschedule/cancel/hold completion called `onClose` directly, bypassing the unsaved payment or failed-storage close guard. | All these drawer callbacks now use the central guarded close path; five added regression cases retain the form when dismissal is refused. |
| High | Initial generic auth-session cleanup | Credential invalidation or sign-in cleanup could delete an unresolved payment envelope after a committed receipt lost its acknowledgment. The next attempt could then receive a new identity. | Generic Firebase session clearing is unchanged. Only explicit logout clears ordinary drafts; unresolved and unreadable copies survive, scoped to their original UID. They remain unavailable to another account. |
| High | `appointment-charges.tsx`, retry catch | A definite 401/403 on a retry says nothing about whether the original uncertain request committed. Clearing pending would permit a duplicate cash entry. | Retry auth/unknown/idempotency failures retain the exact envelope. Positive acknowledgment resolves it; negative resolution is limited to the proved fence case below. |
| High | `chargeRetryWasNotCommitted`, negative replay proof | Expiry alone is a clock condition: an earlier transaction may have read a valid lease and still be committing. A retry's thrown lease error does not itself serialize that earlier transaction. | Before retry, capture an owned different session and an observed advanced appointment version. That durable grant fences the old transaction. Only subsequent `charge_edit_lost`/`charge_conflict`, after the authority checked audit replay first, can establish no commit. |
| Low / test reliability | `appointment-charges-browser.cjs`, absent-request case | Waiting for the retry button to hide could finish during `busy`, before the response. Independent execution caught an immediate disabled-button assertion failure. | Wait for the final enabled payment control, then assert no pending control, identical replay payload and zero receipts. The full final rerun passed. |

No unresolved blocking implementation findings remain.

## Authority, concurrency and recovery assessment

- Recovery is bounded and schema validated, keyed by authenticated UID and appointment
  in sessionStorage. It is loaded only after an authorized fresh record is available
  to a manager. Another user or appointment cannot adopt that copy.
- Restored inputs are requoted. Scope and Field acknowledgments are reset. Stored
  totals, comparison evidence and old edit tokens never authorize a new mutation.
  Historical price rules remain on the existing quote authority.
- Baseline comparison includes full financial state, receipt identities/content,
  candidate fingerprint, blocker and appointment status; only concurrency version
  is omitted. Equal totals with changed services or receipts remain different.
  Lease-only changes may rebase an equivalent recovered draft; financial changes
  require review bound to the current snapshot.
- An own payment/void advances the draft baseline only after reading its exact
  acknowledged version. A later foreign version cannot silently become that baseline.
  Fresh lease credentials remain subject to `ensureVersion` before being usable.
- The exact monetary envelope is persisted before dispatch. Storage failure prevents
  dispatch. Unknown results block new dependent monetary actions and preserve request
  identity across refresh/auth revalidation. Recovery does not auto-submit or finalize.
- The negative replay proof captures its fence before the request, never from a later
  read. The existing authority authorizes the actor, checks immutable audit identity
  before lease/version rejection, and commits receipt/state/event atomically. No server
  algorithm or permission boundary changed.
- Ordinary work survives drawer close/reopen; unsaved payment forms and failed draft
  storage invoke the close guard. Beforeunload warns for work, payment and uncertain
  operations. Explicit draft discard preserves saved receipts and cannot discard a
  valid unresolved operation. Corrupt copies fail closed and require explicit review.
- UI distinguishes recovered unconfirmed work from saved receipts. The 375/250 case
  shows a 125 draft balance, with no invented projection and no automatic finalization.
  PDF behavior remains fresh confirmed work/receipts only; QBO remains official.

## Verification

Independent execution and inspection:

- `npm run test:appointment-charge-recovery`: **7/7 PASS**. Covers exact user/cita
  scope, malformed/oversized inputs, financial equivalence, immutable replay, logout
  retention and negative-proof classification.
- Final unmodified `appointment-charges-browser.cjs`, using isolated Chromium,
  synthetic transactional storage and the real frontend/client/Office facade:
  **6/6 PASS**. Includes 1440/1366/390 flows, 375/250 refresh before finalization,
  finalization/PDF, committed cash with lost acknowledgment, auth denial/account
  isolation/refresh/exact retry, and absent-request expiry versus fresh-fence recovery.
  Evidence: `/workspace/scratch/2d530acc3b67/charge-recovery-independent-flow-final/`.
- Separately reproduced baseline-review invalidation with the real drawer harness;
  PASS. An isolated fence test also passed after waiting for response completion.
  These focused selections supplemented, and did not replace, the required suites.
- Inspected the recovered-before-confirmation screenshot: 3 catalog services,
  375 total, one saved 250 receipt, 125 draft balance and visible recovery status.
- Reviewed all changed assertions and the authority replay/fence ordering. No
  required check was deleted or weakened. `git diff --check` passes.

Builder evidence inspected separately:

- `charge-recovery-evidence/loading-final/results.json`: **56 cases PASS**, including
  close/reopen, user/cita isolation, second-change review invalidation, quota/corruption,
  lifecycle close guards and existing quote/lease/PDF/catalog regressions. Zero external
  requests and production writes. Synthetic 1,000-item local search stays bounded.
- `charge-recovery-evidence/auth/auth-session-results.json`: **41 unit cases plus
  18 Chromium component groups PASS**, including generic invalidation/reauthentication
  retention and explicit logout ordinary-draft cleanup with pending preservation.
- Builder's real financial flow also reports six passing cases. Typecheck and the
  final production build passed (65 routes). Hosted CI/preview remain release gates
  until their successful exact-head evidence is recorded by the release owner.
- Reviewer did not access real customers, write production data, change implementation,
  deploy, or alter Builder evidence directories.

## Decision and residual limits

**Code review PASS; technical GO conditional on final release gates.** Build-generated
`next-env.d.ts`/`tsconfig.json` churn has been removed from the candidate. Before merge
or publication, complete applicable CI on the frozen head, validate the exact preview
and integration diff, and preserve deployment/source/smoke evidence.
This decision does not waive a failed gate or grant deployment authority.

- Recovery covers the same browser tab/session. Clearing storage, closing a tab without
  browser restoration, another device or an explicit ordinary-draft logout can remove
  a draft. The UI and ADR make no durable cross-device claim. Previously vanished inputs
  cannot be fabricated or backfilled.
- A pending request whose original attempt never arrived remains conservatively blocked
  after expiry if the same edit-session identity is reused. Refresh creates a different
  activation; acquiring its grant and replaying then proves absence safely. Same-session
  expiry alone must never be relaxed into proof of failure.
- Storage/quota/corruption failures are intentionally fail closed for monetary dispatch.
  An unreadable envelope requires human review of persisted evidence; the browser must
  not invent a replacement payment. Pending copies remain private to their UID even
  across explicit logout until resolved or explicitly reconciled.
- Browser fault injection uses synthetic auth and storage. Hosted preview, final CI and
  post-release smoke remain the Builder/release owner's responsibility. No new backend
  release is needed; rollback must preserve all recorded receipts and final amounts.
  Resolve pending operations and preserve recoverable drafts before frontend rollback
  where possible; do not clear storage or recreate receipts as a rollback procedure.

Human approval remains required for actions covered by the repository boundary; the
release owner must apply the authorization already established in the user session.
