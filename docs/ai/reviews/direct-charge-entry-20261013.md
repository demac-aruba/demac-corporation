# Review: direct actual-work catalog entry

## Review mode and scope

- Independent Review by `/root/projection_review`; implementation by `/root`.
- Reviewed the complete uncommitted candidate on `fix/direct-charge-entry`, based on
  `f4369f3a4e4835f17cb8a387596494f427af53f0`, including the final picker placement
  correction, updated callers, test adaptations and business-rule/task documentation.
- Applied root `AGENTS.md` Deep Review, Reviewer/QA/Architect lenses, Authority Matrix,
  Business Rules and Quality Gates. Reviewer changed only this report.
- Runtime scope: financial workspace entry, work-list layout, its drawer caller and
  floating catalog placement. No backend implementation, pricing rules, schema,
  permissions, authentication, dependencies, configuration or accounting changes.
- OPS-SCHED-CHARGES-001/002 remain with Office Booking Authority. Pricing remains
  server-owned, persisted final work and receipts retain their existing authority,
  and QBO remains official accounting.

## Requirement and compatibility assessment

The two rejected starting choices are removed. An appointment without confirmed work
opens directly on catalog search and `+ Añadir`; the first selected article starts the
existing recoverable work draft. Later selections append services, products or add-ons
and clear/focus the same search field. Opening the view alone does not create an empty
dirty draft or dispatch a financial mutation.

- Planned work and estimates are no longer copied into a newly initiated actual-work
  draft. This follows the owner's explicit change in workflow. Forecasts remain visible
  and unchanged as reference; new selections use existing catalog quotation behavior.
- Editing a confirmed final still uses `chargeInputFromQuote`, preserving line identity,
  agreed price snapshots and quantity handling. Removing the unused planned seed prop
  is reflected in the production drawer and both synthetic workspace callers.
- Existing recovered drafts retain their schema and storage keys. This change does not
  clear or migrate them, change request identities or alter scope/Field review, lease,
  version, conflict, receipt, replay, confirmation or PDF behavior.
- The first added article and all subsequent articles remain catalog identities with
  server quotes. There is no new BTU prompt, manual price source or automatic financial
  confirmation. Catalog-loading/error/read-only and 60-line limits remain enforced.
- Search stays outside the bounded work-list scroll area. The new empty-state ordering
  places it below the heading; the list no longer fills unused height before the search.
  The existing footer and receipt area remain separate.

## Finding and resolution

| Severity | Location | Evidence and impact | Resolution verified |
| --- | --- | --- | --- |
| Medium / P2 | `charge-catalog-picker.module.css`, floating panel; direct-entry layout | Moving the search near the top exposed the existing always-open-upward behavior. At 1600 px, the top results were clipped by the drawer body/header. The first result was enabled but ordinary clicks were intercepted by the context header. Independently reproduced; this blocked the requested `+ Añadir` flow. | Builder added open-only layout measurement of available viewport/ancestor space, directional placement and a bounded panel height, with border-box sizing. Independent normal-click tests now pass at 1600, 1366 and 390 px, including an already-open popup during resize. |

No unresolved blocking implementation finding remains. The earlier fixture still
passing the removed `seeds` prop was aligned with the final component signature.

The new layout effect is restricted to an open floating picker. It measures DOM layout,
does not fetch or mutate domain state, avoids state updates for unchanged placement,
and removes its resize/capture-scroll listeners on close or unmount. It leaves the
non-floating picker path unchanged. Native selection, input focus and Escape-layer
handling remain in place.

## Verification

Independent execution and inspection:

- Before correction, the direct-entry test failed on the first normal catalog click;
  inspected the screenshot and pointer-interception log in `direct-charge-independent/`.
- After correction, **5/5 focused real drawer cases PASS**: direct entry at 1600,
  1366 and 390 px; historical estimate retained without automatic copying; historical
  confirmed agreed price retained while quantity changes. These assert no extra catalog
  loads or financial writes, cleared/focused search, successive service/product/add-on
  selection, no BTU reconfiguration and no horizontal overflow.
- Separate open-popup resize probe **PASS**: 1600 to 1366 to 390, followed by a normal
  click on the first result. Actual hit tests reached result content. At 1366 the popup
  occupied y=193..385 inside the drawer body y=189..745; at 390 it occupied y=226..558
  inside y=222..843. An initial overstrict diagnostic treated the zero-height document
  body as a real clipping box; direct geometry/hit testing rejected that false alarm.
- Inspected fresh empty and three-line screenshots at desktop and mobile widths.
  Search is immediate in the empty state, remains separate from the scrolling work
  list, and final review/confirmation is retained.
- Read the complete diff and changed tests. Replacing the removed planned-copy setup
  with explicit selection retains the existing version/Field assertions. Historical
  coverage is split into immutable estimate and editable confirmed snapshot cases.
  The removed empty-state sentence is replaced by assertions for missing projection,
  pending final, no actual row and no false paid status. No financial gate was weakened.
- `git diff --check` passes. Build-generated `next-env.d.ts` and `tsconfig.json` changes
  have been removed from the candidate.

Independent evidence is under `/workspace/scratch/2d530acc3b67/`:
`direct-charge-independent-fixed/` and `direct-charge-independent-resize-probe/`.
Focused cases were selected in memory from the existing harness and supplement the
full suites; no implementation or repository test files were modified by the reviewer.

Builder-run evidence inspected separately:

- `direct-charge-evidence/drawer/results.json`: **60 cases PASS**, zero external
  requests and zero production writes. Includes direct entry, historical pricing,
  large-list/search/footer behavior, quote/lease/conflict/Field checks, recovery,
  storage failures, close guards and fresh PDF behavior.
- `direct-charge-evidence/flow/results.json`: **7 real frontend/client/Office facade
  flows PASS**, including 1440/1366/390, 375 work minus 250 receipt equals 125, History
  return, refresh before finalization, final persistence/PDF, unknown cash acknowledgment
  and exact retry without duplicate receipts.
- `direct-charge-evidence/cutover/cutover-results.json`: **18 old/current-client
  cutover cases PASS**.
- Final ERP typecheck and complete prebuild/production build PASS; final logs inspected.
  Synthetic 1,000-item/59-line local search remains bounded, with no network or authority
  request while typing. Those local timings are not production latency guarantees.

## Decision and residual limits

**Code review PASS. Technical GO conditional on exact-head CI, preview and release
verification.** Preserve current main's integrations, publish the reviewed frontend
source, verify deployed source/assets and record smoke evidence. This review neither
waives a failing applicable gate nor independently grants deployment authority.

- Emulated mobile Chromium and normal pointer interaction were verified; physical
  mobile keyboards and every browser/device combination were not tested.
- The existing sessionStorage recovery limits remain: private draft recovery is not
  cross-device financial persistence. Historical inputs already lost cannot be recreated
  by this UI change. Confirmed work and receipts retain their server persistence.
- A historical forecast remains a reference; removing its copy action intentionally
  does not transfer its lines into actual work. Existing confirmed agreed prices remain
  editable, and no saved forecast is rewritten.
- No real customer record was read or changed, no production financial CRUD was tested,
  and reviewer executed no deployment or communication. Rollback is frontend-only and
  must preserve every receipt, final snapshot and local pending-operation envelope;
  no backend release, data deletion, repair or migration is implied.
