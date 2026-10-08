# PR 526 — owner-approved live release

The owner explicitly authorized merge and live deployment on 8 October 2026,
18:08 -04, to begin real-device acceptance while retaining the existing ERP design.

Verified PR head: `9e72d6ec4d408800430146612d5408bb1e7f9e08`.
Merged main: `0c8cf94f3972ec63d8126327a57ba877d3b205a4`.
The merged tree is identical to the verified candidate. This release authorization
changes documentation only and directly follows that merged main.

All 23 pull-request workflows succeeded on the final head:

- [Actual compiled app/login and assigned roles](https://github.com/demac-aruba/demac-corporation/actions/runs/37853542534).
- [425 backend tests and real emulator/Office review flow](https://github.com/demac-aruba/demac-corporation/actions/runs/37853542564).
- [UI, original media and draft recovery](https://github.com/demac-aruba/demac-corporation/actions/runs/37853542611).
- [Native audio](https://github.com/demac-aruba/demac-corporation/actions/runs/37853542489).
- [ERP build and scheduling regressions](https://github.com/demac-aruba/demac-corporation/actions/runs/37853542716).
- [Scoped release and configuration guards](https://github.com/demac-aruba/demac-corporation/actions/runs/37853542570).

The shared login is byte-for-byte main/live, SHA-256
`425d8d24eee36b1c84c2e95d9fa371bc813c41e7f2b1f34396ca39445960437f`.
Global styles, root layout and administrative navigation remain unchanged.

Publish this release commit to Vercel project `demac-corporation-web`, ID
`prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7`, team `team_DMKv1yhhUjnR4Pu141k3iwuX`,
using existing production configuration. Verify both `demac-aruba.com` and
`www.demac-aruba.com` serve that exact commit. Only then may the scoped workflow
publish `fieldOperationsAuthority` source in Firebase project `demac-corporation`,
us-central1, with existing runtime settings, identity and dependency lock.
Verify uploaded source bytes, anonymous rejection, CORS, six neighboring functions
and the existing daily scheduler; no customer/catalog/security/IAM writes.

This document authorizes the already requested operation; it does not claim the
asynchronous deployment has completed. Record actual deployment and workflow results
in the PR after verification. Previous frontend deployment is
`dpl_7E94hXZQwhJQn5WRFdmM59dvxWKS`; the backend summary retains its previous source
and revision. Follow the activation runbook for recovery without deleting records.

Physical-phone acceptance remains pending after publication, per the owner's
instruction. Selected Standard Service catalog activation remains separate and
unmodified; no article is inferred from its name. Real users use their existing
DEMAC accounts, not the temporary preview's synthetic credentials.
