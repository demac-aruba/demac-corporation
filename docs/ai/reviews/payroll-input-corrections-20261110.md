# Review: audited advance and bonus corrections

## Review mode and scope

Solo Maintainer Adversarial Review by Codex, separately performed after implementation;
not an independent review. Reviewed complete feature diff against base
`63aaddae33a5c4ab357e3ddc3cc69ef2753948c6`, all advance consumers, bonus creation/cancellation,
canonical identity mapping, authenticated REST transaction helpers, payrollRole rules,
Employees/Finance exports, UI state and failure recovery. Owner intent: edit/delete with
operator identity and mandatory explanation, without losing history.

## Findings and resolutions

- **High, resolved:** Deleted advances must not count in either report path. Both summary
  surfaces and PDF/CSV projections now filter retained voids; legacy missing-status inputs
  count. Ledger keeps deleted entries and History. Active advances belonging to former
  employees remain in both accountant exports and the period KPI.
- **High, resolved:** Inherited PATCH preconditions failed the real emulator despite a
  valid read timestamp. New corrections use the existing attendance batchGet/commit helper,
  preserving document version checks. Actual Rules allow/deny/revocation and committed
  retry tests pass. No gate, precondition or permission was weakened.
- **High, resolved:** Target baseline includes every editable field, status, updatedAt and
  full history. A concurrent category-only edit rejects. Unrelated array/schedule updates
  are preserved through bounded reread/revalidation. Duplicate/foreign/missing targets,
  malformed history, inactive callers and terminal voids reject. Creation metadata stays
  unchanged, no secondary identity/collection or physical delete.
- **Medium, resolved:** Exact request replay must not append twice after response loss.
  Stable request ID plus actor/reason/baseline/after fingerprint recognizes a committed
  request, including after later corrections. Altered replay rejects. UI retains data and
  request on failure; refresh reads canonical saved state. No optimistic financial success.
- **Medium, resolved:** Dialog inherited table nowrap and clipped the mobile operator note.
  Explicit normal wrapping now fits; desktop/mobile screenshots inspected. Select controls
  have exact accessible labels, native modal focus containment, required reason, disabled
  save while pending and a separate deletion confirmation. No new app dependency.
- **Medium, resolved:** Firestore normalizes `.000Z` timestamps to `Z`; sequential edit/delete
  could falsely reject an unchanged target. A failing real-emulator regression confirmed it.
  Application timestamp comparison now accepts the same instant, while exact database
  updateTime preconditions and complete business/history comparison remain unchanged.
- **Medium, resolved:** Initial CI exposed an unnecessary change to the shared attendance
  visibility guard (older attendance fixtures omit principal.active). Reverted that unrelated
  guard to its original behavior. Correction commands still require an active principal and
  actual server payrollRole authorization. Existing attendance gates are rerun unchanged.
- Existing history is application audit under the existing trusted payroll writer boundary,
  not a claim of server-enforced append-only immutability. Rules remain active admin/accounting.
  Creator/editor names come from the signed-in UI principal, not an editable audit field.

## Verification

- `test:payroll-input-corrections`: passed positive/invalid amounts and dates, empty reasons,
  inactive/unauthorized principals, server denials, changed target/category, independent
  settings and deductions preserved, response loss, exact/altered replay, no-op/terminal
  cases, 27–26 period moves, retained history and active-total exclusion; also malformed
  history, employee mismatch and missing target rejection.
- Existing `test:employee-bonuses`: passed creation/Legacy mapping, all categories,
  concurrency, cancellation compatibility and unchanged attendance hours/PDF/CSV regression.
- Real Auth/Firestore emulator with repository rules: admin and accounting writes allowed;
  office, technician, inactive, unprovisioned and invalid token denied even with a forged
  client permission object; revocation between read and commit denied. Lost commit response
  recovered with exactly one history event. Synthetic demo project only.
- Real Employees/Finance browser components + REST adapter: desktop and mobile each passed
  three creates, two edits, two logical deletions, history after reload, required reason,
  uncertain commit retry, six exports and zero external requests. Restricted-role test
  performed zero payroll reads. Inspected advance editor/history and bonus history images.
- ERP typecheck passed. Full prebuild suites passed; Next production build passed after
  replacing an external dependency symlink with an ordinary local install. Final focused
  checks cover the later correction transport and display changes. Build-generated config
  modifications are excluded from the feature.
- `git diff --check` passed. No Functions code, rules, production settings or data touched.

## Decision and remaining boundaries

PASS for feature review; merge/release still require normal CI and explicit owner approval.
No live signed-in mutation or production deletion was performed. No statutory payroll,
refund, QBO or attendance recalculation is introduced. Previously downloaded reports remain
snapshots. Legacy unconditional payroll writers and the shared Firestore document-size
limit remain existing constraints; document exhaustion rejects atomically. Release is
frontend-only; rollback must keep advance void filtering to avoid recounting deleted inputs.
