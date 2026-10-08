# PR 526 — verified production recovery release

Owner authorization: 8 October 2026, 18:08 -04, merge and live deployment to begin
real-device testing while retaining the existing ERP design.

PR #526 verified application head `9e72d6ec4d408800430146612d5408bb1e7f9e08`
passed all 23 workflows and merged as `0c8cf94f`. The original ERP shared login,
global styles, root layout and administrative navigation remain preserved.
Initial production frontend `dpl_HsqxzrNp7nukijf9x1ppqdL4MdVY`, source `23ba2497`,
is READY on `demac-aruba.com` and `www.demac-aruba.com`.

The initial bounded backend run 37854324540 stopped before deployment. Read-only
diagnosis 37855572975 confirmed Field revision `fieldoperationsauthority-00006-bag`,
identical declared dependencies and no historical package-lock.json in its source.
PR #561 fixes this legacy-source case while preserving every existing guard:
existing compatible locks remain byte-for-byte; absent locks require identical
manifest dependencies and use the exact lock from the required CI-tested install.
Nine regression/config tests and both applicable PR workflows passed on
`e90c911d18f2c00e25f62afe389d0df0222c3019` (runs 37855722904 and 37855722879).
The correction changes release tooling/documentation only, not application code.
Corrective merge: `fc09e0be77f22ec67b87af66f546a0464fc7a11a`.

This documentation-only release directly follows that current merged main. Publish
its exact SHA to existing Vercel project `demac-corporation-web`,
`prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7`, team `team_DMKv1yhhUjnR4Pu141k3iwuX`, using
unchanged production configuration. Require that SHA and original login on both
real domains before deploying only existing `fieldOperationsAuthority` source.
The scoped workflow must verify uploaded source and lock, identical runtime,
CORS/anonymous denial, six neighboring functions and the daily scheduler unchanged.
No customer/catalog/security-rule/IAM/secret writes are included.

Physical-device and owner operational acceptance remain pending after deployment.
Standard Service catalog activation remains separate: no article was selected or
modified. The old source had no lock, so historical resolved transitive versions
cannot be asserted identical; the published lock freezes the CI-tested versions.

Record actual asynchronous publication results and revision evidence in PR #526
and PR #561 after the workflow finishes. Do not mark backend deployment complete
based only on this authorization. Recovery rules retain private originals, protocol
readers and immutable revisions; never delete records to roll back a screen.
