# Review: appointment charges workspace, actual balances and operational PDF

## Review mode and scope

- Independent Review: `/root/projection_review`; implementation author: `/root`.
- Reviewed the complete change from `aeaa9bb5` to local `9b921bcc` (remote
  `686fc9bf`, tree `e88ac650`, as recorded by Builder), plus the final PDF
  continuation spacing correction. The report itself does not change implementation.
- Task: `../tasks/charges-workspace-balance-20261013.md`. Deep Review under
  `AGENTS.md`, Reviewer/QA/Architect roles, Authority Matrix and Quality Gates.
- Affected surface: ERP financial drawer, overview, shared quotation hook, catalog
  popup presentation, balance helper and browser-only PDF. Reviewed their existing
  read, lease, mutation, history and retry dependencies. No backend, schema, rules,
  credentials, runtime configuration, invoice issuance or QBO write change.
- Authorities: OPS-SCHED-CHARGES-001/002 remain with Office Booking Authority.
  Pricing Authority resolves prices; recorded appointment receipts reduce balances;
  QBO remains the official accounting boundary.

## Finding and resolution

| Severity | Location | Evidence and impact | Resolution |
| --- | --- | --- | --- |
| Medium / P2 | `apps/erp-next/lib/appointment-charges-pdf.ts`, `newPage` and `tableHeader` | On continuation pages, the table background started above the preceding citation baseline and covered the lower part of the appointment ID. Independently reproduced by rendering page 2 of the 60-line PDF. | Builder added 12 points after the continuation citation and a geometry regression test. Reviewer checked the exact delta, reran 10/10 balance/PDF checks and inspected the corrected page. Appointment identity is now fully visible above the table. |

No unresolved blocking code findings remain.

## Business, authority and failure review

- Both overview and editor use actual work for balance calculations. Booking projections
  remain reference information; they never supply a debt or a credit. A missing final
  stays pending. A legacy appointment without financial state and without receipts can
  correctly preview the entire quoted draft balance, provided no reconciliation blocker
  exists. Explicit zero and unknown values remain distinct.
- Draft balance uses only a current complete server quote and saved receipts. Quote
  signature/version changes invalidate the old value during render as well as effects;
  delayed responses cannot replace later input. Loading, quotation errors, conflicting
  versions, unknown outcomes and failed reads suppress the draft balance. An edited
  zero balance is labelled as a draft, never as a paid confirmed visit.
- Existing financial versions, lease ownership, same-request retries, historical agreed
  prices, projection-only snapshots, own receipt/void draft rebasing and Field evidence
  reconciliation are preserved. Mandatory correction reasons and scope acknowledgment
  remain enforced. Success feedback expires after 4.5 seconds; errors and uncertain
  outcomes retain their recovery controls.
- PDF export calls the existing authorized transactional read afresh. Reader access
  suffices; export does not acquire a writer lease or mutate financial data. Final lines,
  currency, line sums and recorded receipt sums are checked; missing final values,
  forecast-only lines and reconciliation blockers reject export. Voided receipts are
  labelled and excluded from the received total.
- The PDF contains confirmed work and persisted payments, not an unsaved draft. It
  identifies the appointment, financial version and issue time, states its operational
  purpose, and neither numbers invoices nor infers taxes. Generation has no external
  font/resource requests, uploads, messages or accounting calls. Late results are
  discarded when leaving the view; duplicate download clicks are fenced locally.
- Financial layout classes are scoped to the financial tab. The scrollable work list
  leaves search and confirmation accessible; receipt details remain available through
  disclosure controls. Existing appointment summary and lifecycle flows are preserved.

## Verification

Independent execution and inspection:

- `NODE_PATH=/workspace/scratch/d9d85ba4529e/demac-corporation/functions/node_modules node --test functions/appointmentCharges.test.js functions/appointmentChargeEditing.test.js`:
  **43/43 PASS**, zero skipped. Covers monetary identity, historical snapshots,
  permissions, exact replay, versions, receipt/void behavior and lease fencing.
- `npm run test:appointment-charge-display` in `apps/erp-next`: **10/10 PASS**;
  repeated after the PDF correction and added geometry regression. Covers 375 work minus 250 received, independence
  from forecast, missing/zero/credit/error states, rejected draft/blocker/mismatch
  exports, voided receipts, 60 long lines and escaped special characters.
- Regenerated synthetic PDFs, parsed their structure with Poppler and inspected the
  one-page example plus a rendered overview of all 16 long-document pages. Inspected
  continuation page 2 at higher resolution, identified the overlap, and inspected its
  corrected render. Amounts, accents, final line and page identities are retained.
- Read all changed tests and reviewed their assertions; no required gate was removed
  or weakened. `git diff aeaa9bb5 --check` passes. Build-generated TypeScript files
  were removed from the final implementation diff.

Builder-run evidence inspected separately:

- Real frontend/client transport/Office facade over isolated synthetic transactions:
  PASS at 1440, 1366 and 390 pixels, including adding catalog articles, fractional
  quantity, payment/void during a draft, exact retry and persisted final total 497.50.
  Additional no-projection case confirms 375.00 work minus 250.00 transfer equals
  125.00 before/after confirmation, survives reload and appears in the downloaded PDF.
- Actual drawer/loading/concurrency suite: **44 cases PASS**. Includes stale/error
  quotes, draft preservation, lease expiry/fencing, read-only PDF without a lease,
  fresh receipt balance, fresh blocker rejection and close-during-download cancellation.
- Synthetic 1,000-item catalog / 59 existing lines: 60-line and 40-result bounds;
  15 typing samples, median 63.2 ms and p95 112 ms to two animation frames; zero
  authority or network requests while typing. These are local synthetic measurements.
- Existing drawer regressions, ERP typecheck and full production build reported PASS.
  Evidence is under `/workspace/scratch/2d530acc3b67/charges-workspace-evidence/`;
  `loading/results.json` and `flow/results.json` were inspected directly.
- Browser verification blocks external requests and uses synthetic customer, catalog
  and receipt records. Reviewer performed no production reads/writes or deployment.

## Decision and release gates

**Code review PASS.** Technical GO for the reviewed frontend correction, conditional
on the existing release gates completing on the final head including the spacing fix:
applicable CI, exact preview, integration comparison and deployed-source/smoke checks.
CI and preview were still running when this report was written; this report does not
claim their success. Builder must record their exact final evidence before publication.
The owner's existing conditional authorization governs merge/deploy; this review does
not independently authorize production actions.

Residuals are bounded: the document is an operational snapshot at read time, not a
live balance or official invoice; unsupported font code points are displayed visibly
as `[U+XXXX]`. No production-customer or real-device mobile test was performed. These
limits do not block the requested scope. Further invoice/tax/customer-delivery features
require a separate authority review.

Release is frontend-only. Recovery is to the prior frontend deployment, currently
recorded by Builder as `dpl_HHYxEWTGWnqvLH3qRBGkBuDdrTRm`; verify that target before
use. Keep the compatible backend and all saved work/receipts. No financial-data restore
or backend downgrade is part of recovery. Builder owns final release evidence and
post-deploy smoke verification before declaring the task complete.
