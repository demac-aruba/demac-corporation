# Review: One-step appointment receipt entry

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer: `/root/projection_review`; builder: `/root`.

## Scope

Reviewed complete payment component/style diff and affected browser consumers against the owner-approved 2026-10-19 proposal, OPS-SCHED-CHARGES-001/002, Office facade/payment authority and AGENTS.md. No backend, schema, permissions, official QBO accounting or migration changes.

## Findings

| Severity | Location | Evidence/impact | Correction |
| --- | --- | --- | --- |
| Medium | appointment-finance-cutover-browser.cjs current-client case | Old trigger/save selectors would block the required compatibility gate | Adapted only finance-new to the direct field + Registrar pago; finance-old retained unchanged |

No outstanding blocking implementation findings. Empty defaults remain outside dirty/recovery/suspend state. First input captures version; pending payload remains immutable; same-session rebasing and lease fences remain. Clearing is disabled during a write/uncertain result. Backend confirmation alone resets the form and reports success.

## Independent evidence

7/7 isolated browser scenarios passed: pristine form permits focus revalidation from v1 to v2, first input captures v2, a 61-second clock advance retains entered date, beforeunload guard changes only on actual edit, desktop/laptop/mobile form, double click produces one request, backdate/note retained, conflict blocks writes and uncertain retry sends identical payload. No external requests or production writes. Screenshots inspected at 1366x768 and 390x844; normal scroll remains available on short screens.

## Decision

- [x] Pass, conditional on complete required CI/build and integration suites for the exact published head.

Residual limitation: independent probes use isolated synthetic authority fixtures, not live customer payments. Full HTTP facade and backend regression evidence is supplied by Builder. The feature retains the existing operational receipt semantics and date captured when entry begins; it does not charge POS/SUAVE or create an official QBO invoice.

Human approval: approved visual design on 2026-10-19 plus standing audit-then-merge/deploy authorization in this conversation. Production release must still verify current main, exact source and domains; roll back frontend only, preserving all receipts.
