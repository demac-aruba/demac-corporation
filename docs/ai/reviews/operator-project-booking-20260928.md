# Review: Office Operator scheduling of existing Projects

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: independent `/root/operator_project_independent_review` agent (read-only review).
Implementation author / agent: `/root` and delegated frontend/backend builders.

## Scope reviewed

- Request/acceptance criteria: Office Operators can search and schedule an existing shared Project from New Appointment without Project planning authority, while Regular Booking continues to work.
- Diff/commit: `fix/operator-project-booking-20260928` against `origin/main` (pre-commit review).
- Affected callers/integrations: Project Authority API, shared Projects client, New Appointment drawer, Office Booking gateway, Booking Authority Project link, Scheduling cards.
- Authorities and rule IDs: `OPS-PROJ-SCHED-001`; Project Authority, canonical CRM, Booking Authority and capacity locks.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Medium, resolved | `functions/officeBookingAuthority.js` | Spaced/hyphen Office Operator role aliases passed frontend/Project API but failed the Office Booking gateway. | Normalize role punctuation; add gateway and Project offer-forwarding tests. |
| Medium, resolved | `functions/projectRecords.js` | A schedule-only operator with a missing `active` field could read Projects, unlike the ERP principal requirement. | Require explicit `active === true` for non-manager scheduling roles; retain legacy manager behavior. |
| Low, follow-up | Existing manager role aliases in Office Booking gateway | Some manager aliases already saw the Project picker before this change but are not accepted by the Office Booking gateway. Broadening that gateway would grant unrelated office actions. | Separate access review; do not expand it in this operator-scoped fix. |

## Verification

- Required checks run: ERP typecheck; Projects and Scheduling focused acceptance tests; Functions validation; ERP production build; focused backend tests; complete Booking Authority regression; `git diff --check`.
- Results: ERP and Functions checks/build passed; focused backend 46/46; Booking Authority 181/181. Node's default isolated test worker spawn was blocked by sandbox `EPERM`, so tests ran with `--test-isolation=none`, without skipping cases.
- Security and permission cases: office/operator/office_operator/spaced/hyphen aliases; inactive/unprovisioned denial; planning and historical correction denied; finance/unrelated role denied; full Project financial fields not returned in operator projection.
- Business-invariant cases: published canonical Project and CRM Property required; Project slot budget, phase status, Appointment/Work Order identity and Scheduling label consistency.
- Retry/concurrency/idempotency cases: Booking Authority replay does not duplicate links; Project version and role rechecked at transaction commit.
- Failure/recovery cases: stale Project version, revoked role, mismatch and occupied capacity reject without partial booking; no production records modified.
- Unverified areas: authenticated operator visual check and production availability after coordinated backend-before-frontend rollout; Project portfolio cap of 200 remains pre-existing.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

Residual risk, owner, and due date: engineering owns the pre-existing manager alias mismatch and pagination cap as separate follow-ups; owner/operator preview remains required before production approval. Deploy Project API/Booking Authority backend support before the UI that calls `schedule_list`.

Human approval is still required for the security/access change and production deployment under the repository Human Approval Boundary.
