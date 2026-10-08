# Task: publish PR 526 with the existing ERP design

## Context and scope

The owner explicitly authorized merge and live deployment on 8 October at
18:08 -04 to begin real-device testing, conditional on preserving the existing
ERP design. This supersedes the earlier lack of deployment authorization, and
places physical acceptance after publication without claiming it has passed.
Source checkpoint: `43c1349f3f3681910647b20650b5fa4ab84f6c65`;
integrated main: `c45d51d03840019cbfe68a2ca9ae5e067532077f`.

Restore the shared login byte-for-byte from main, retain Field improvements,
verify the final candidate, merge and publish to the actual business domains.
Publish only Field backend source with existing runtime/dependency declarations.
No catalog activation, customer-data writes, security-rule/IAM/secret changes,
or unrelated function deployment is part of this task.

## Governance

Deep Review / Solo Maintainer Adversarial Review. Existing Field, authentication,
catalog, scheduling, inventory and communication authorities remain unchanged.
This is deployment of the already reviewed protocol, not a new data authority.
Admin shell and global styles remain unchanged. No Legacy implementation change.
Authority and recovery obligations follow the PR's existing authority matrix and
`docs/technician-portal-v2/activation-pr526.md`; no new ADR is needed.

## Acceptance and plan

- [x] Confirm actual production domains/project and current deployment.
- [x] Restore the existing shared ERP login and retain its authentication behavior.
- [x] Add a bounded release path that verifies exact frontend source first,
      preserves Field runtime/lock, and verifies neighboring services unchanged.
- [x] All 23 applicable checks pass on final PR candidate `9e72d6ec` before merge.
- [x] Merge exact verified head as `0c8cf94f`; publish its application code to both live domains.
- [ ] Publish only Field source and verify source bytes, runtime, access boundaries,
      neighboring functions and the daily scheduler.
- [ ] Record exact final commits, workflow/deployment evidence and residual limits.

## Risk and recovery

The old general pipeline can republish unrelated functions on package changes.
Keep its merge-only guard; use a dedicated release workflow restricted to an exact
branch, current main parent and a documentation-only authorization commit.
The frontend must be present before the compatible backend source is deployed.
An existing running dependency lock is reused only if its manifest matches reviewed
dependencies. When historical source has no lock, unchanged dependency declarations
are mandatory and the exact lock used by the required tests is introduced. Existing
config/source and adjacent services are compared before and
after. A concurrent release or failed precondition stops the operation.
Previous live Vercel deployment: `dpl_7E94hXZQwhJQn5WRFdmM59dvxWKS`.
The backend summary saves the prior revision/source reference for recovery; no data
deletion or rollback of already-created immutable records is permitted.

## Verification

Local ERP typecheck and seven release/config guard tests pass. The final candidate
must pass all applicable existing PR workflows, including actual compiled login
and assigned-role browsing in Chromium/WebKit, build, audio, drafts and real emulator
authority tests. Only the login heading expectation changes to the actual retained
ERP heading; no test is removed or relaxed. Physical-phone and owner acceptance
remain pending after release. Catalog articles remain unselected/unmodified.

## Deployment recovery

The frontend is READY at `dpl_HsqxzrNp7nukijf9x1ppqdL4MdVY`, release `23ba2497`.
Two attempts of run `37854324540` stopped before backend deployment. Read-only
diagnostic run `37855128604` identified an absent lock in legacy Field source,
not a runtime/dependency mismatch. Preserve all original guard tests; add negative
cases proving that absence requires identical dependency declarations and a matching
tested lock, and that an existing mismatched lock never falls back. No application
code, backend behavior, permissions or deployment configuration changes in this fix.
