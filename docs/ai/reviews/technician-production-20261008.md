# Review: PR 526 production release and preserved ERP design

## Review mode

- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review

Builder and reviewer: Codex, separate implementation and adversarial passes.
This review covers the final delta after `43c1349f`, including the shared login,
its actual-app browser assertion, release workflow/script/tests and runbook.
Earlier protocol/auth/media/recovery review remains in
`technician-completion-20261007.md`; current main is already integrated.

## Findings and resolution

| Severity | Evidence and effect | Resolution |
| --- | --- | --- |
| Medium | The technician preview replaced the shared ERP login, conflicting with the owner's existing-design requirement. | Restore main's login exactly; retain auth provider/session protections and technician improvements. |
| Medium | The broad main pipeline could republish unrelated functions on this PR's package changes. | Preserve `[merge-only]`; an exact release branch publishes only Field source after required tests and verified live frontend. |
| Medium | Comparing only app/backend directory trees would overlook other build inputs. | Require a documentation-only release diff as well as identical application/workflow/script trees and an immediate current-main parent. |
| Low | Live Field rejects an empty request with 400 before authentication; that is not a valid 401 smoke request. | Use the existing read-only `get_schedule` action without a token, as the original deployment smoke does; retain the exact 401 requirement. |

## Adversarial pass

Reviewed all changed files and affected login/auth/browser callers. The login has
the same submit, role-routing and session logic as main; its file hash matches main
(`425d8d24eee36b1c84c2e95d9fa371bc813c41e7f2b1f34396ca39445960437f`).
Global styles/root layout and the administrative shell branch are unchanged.
The existing browser check still performs real password sign-in, role routing and
assignment isolation, using the retained accessible labels/button. Only the heading
expectation reflects the original ERP presentation.

The privileged workflow is not enabled for pull requests or main. Tests and exact
source/frontend checks precede credential access. It does not accept user-supplied
runtime options, mutate IAM/env/secrets, change scheduler settings, or contain a
database client. Deployment command selects only the existing Field function and
preserves its current identity. Failed context/runtime/lock checks reject. The
release cannot silently use newer/unmerged code; source/config concurrency is
rechecked before deploy. Uploaded runtime/test JavaScript and dependency lock are
compared byte-for-byte; six other function revisions/configs/source and scheduler
settings are checked unchanged. Function `.gitignore` excludes dependencies and
local Firebase/env files, not tracked source/test files. Authenticated domain
behavior is covered by the existing emulator gates; production smoke performs only
anonymous denials/CORS reads, with no customer writes.

## Verification and decision

Local ERP typecheck, script syntax and seven negative-context/runtime/dependency/
config tests pass. Final PR CI remains a mandatory pre-merge gate; recorded results
must identify the exact final head, not reuse earlier green checks as its result.

- [x] Pass with recorded follow-up, conditional on final candidate CI passing
- [ ] Block / changes required

Owner deployment approval is already explicit in this session. Physical device
recording/playback, owner operational acceptance and selected catalog activation
remain follow-ups; none is represented as passed. Deployment health can fail after
a valid publication attempt; report actual state and retain compatible readers,
private originals and immutable revisions rather than deleting records.

## Post-merge release diagnosis

Final head `9e72d6ec` passed all 23 workflows, including the actual compiled app's
Chromium/WebKit login/role flows. PR #526 merged as `0c8cf94f`; production frontend
`dpl_HsqxzrNp7nukijf9x1ppqdL4MdVY` serves release `23ba2497` on both real domains.
Backend run `37854324540` passed the exact live frontend check but stopped in
preflight before any deploy command on both initial and one retry attempt.

A separate adversarial pass reviewed the diagnosis-only workflow and script:
fixed task branch/repository, seven known function metadata reads, one existing
scheduler read, download of the existing Field source archive to runner temporary
storage, dependency-lock comparison and deletion of that local temporary archive.
There is no deploy, database operation, IAM/configuration change or raw cloud output.
Only operation stage, allowlisted error category and non-secret revision/status
metadata can reach logs. Syntax and existing guard tests remain required. The
failed production check remains failed until its actual cause is corrected.

### Diagnosis and separate correction review

Read-only run `37855128604`, job `113577358639`, confirmed all seven functions
ACTIVE, the existing scheduler unchanged, and Field revision
`fieldoperationsauthority-00006-bag`. The source archive downloads successfully,
but extracting `package-lock.json` returns unzip status 11 (no matching file).
The historical source has no lock; the prior requirement assumed one existed.
No backend deployment occurred during either failed release attempt.
Follow-up read-only run `37855572975` passed and explicitly confirmed
`dependencyDeclarationsMatch: true` and `lockPresent: false` for the live source.

Reviewed the correction separately: preserve every original test and check. For
legacy source without a lock, require exact equality between its dependency
declarations and the reviewed manifest, then use the identical lock from the
installation that passed the mandatory Field tests in the same job. An existing
running lock is still reused exactly; malformed/incompatible locks cannot fall
back. New negative regressions prove both boundaries (nine total guard/config
tests pass). The uploaded lock must still match byte-for-byte after deployment.
The new release branch still requires current main as its immediate parent and
a docs-only change, plus exact source serving on both live domains before deploy.

The temporary diagnosis script/workflow has fulfilled its read-only purpose and
has no production callers; remove those task-only entry points while preserving
their source in commit `7d9714da` and their execution evidence above. The release
publisher now identifies each preflight stage and logs only its fixed non-secret
summary after success. Residual risk: without a historical lock, the previously
resolved transitive versions cannot be asserted identical. The new lock freezes
the versions exercised by CI; published source, live authentication/CORS and runtime
preservation remain mandatory. This is an explicit correction of a false legacy
source assumption, not a waived or weakened failed security check.
