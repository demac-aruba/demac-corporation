# Review: authenticated attendance web save

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer: /root/attendance_review. Builder: /root.
Reviewed source: 4d419099e974ff0aaeb59febacd93aefb2592a36 and the complete diff from
292ce0ab146c5acaf2675d2ce1785c17e1cd3102, including the sole runtime caller.

## Scope and findings

Payroll attendance transport, exact target/neighbor version checks, masked updates,
role denial, stale edits, lost responses, synthetic test isolation and read-only production
diagnostics. Authority remains employeeTimesheets and existing payrollRole Rules.
No runtime/caller/workflow/audit blockers found. No permission or production-data changes.

The original transaction protocol differs from the official Firebase web SDK. Evidence
supports changing to BatchGet/Commit with updateTime/exists plus read-only Verify entries.
Do not claim to have captured the user's production failing request: the filtered logs
were empty and the emulator accepts BeginTransaction. This diagnostic limit does not
justify weakening access controls or transaction integrity.

## Independent verification

- git diff --check, diagnostic script syntax: PASS.
- Repeated npm run test:employee-attendance: PASS (domain, save and transport contracts).
- Repeated real Auth+Firestore emulator suite with unchanged Rules: PASS.
- Admin/accounting allow; office/technician/inactive/unprovisioned/anonymous deny.
- Existing and missing neighbors verified without create/delete side effects.
- Target and neighbor create/update/delete races abort; revocation before commit denies.
- Full split 570 minutes at 200%, response loss, exact retry: one historical entry.
- CI browser evidence 40258094150 confirms real login/REST save/reload desktop/mobile,
  while all nonlocal requests remain blocked. This is not a real-employee production save.

## Decision

- [x] Pass
- [ ] Pass with recorded follow-up
- [ ] Block / changes required

Residual limit: the original failed production request has not been observed. Release
only after the remaining required CI gates pass; then verify exact frontend SHA/domain.
The owner authorized the feature's merge/deploy and explicitly requested this repair.
No backend, Rules, IAM, migration or employee-record action is part of the release.
