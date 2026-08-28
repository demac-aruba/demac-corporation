# Technician Portal engineering review packet

Review date: 2026-08-28

## Scope reviewed

- Requirement: canonical Technician Portal continuation after Voice/Audio Evidence, including Professional Report readiness, planned-work reconciliation, return visits, Office Review, Field sales, histories, Inventory/Billing candidates, optional QR, offline hardening and mandatory scenarios.
- Implementation range reviewed incrementally through: `58ddbab556cc9d97c0e500cbcb04705303b65854..edc9f3899418a0ac665300625ffaea101d3cf844`.
- Authorities: Scheduling/Appointment remains planned truth; Field Operations owns actual visit/work/review state; CRM owns Customer/Property/Asset; canonical catalog/pricing owns identity and prices; Inventory/Billing remain downstream authorities.
- Prohibited effects checked: the explicitly authorized assignment-aware Rules change is branch-only; no production deployment, secret change, migration, customer communication, stock movement, invoice, Accounting or QBO write occurred.

## Findings resolved during Builder review

| Severity | Evidence | Impact | Resolution |
|---|---|---|---|
| Medium | `TECHNICIAN_PORTAL_ARCHITECTURE.md` still said Office Review submission had to move server-side | Durable architecture documentation contradicted the implemented authority boundary | Updated to name `fieldOperationsOfficeReview.js` as the existing production command/readiness authority |
| Low | Architecture evidence still reported the old 107-test checkpoint and described implemented modules as later slices | Reviewers could mistake stale checkpoint evidence for current coverage or scope | Updated to the current 340 core + 45 extension + 94 Booking evidence and separated activated modules from remaining downstream boundaries |
| Low | Acceptance evidence used trailing whitespace for a hard line break | `git diff --check` failed the universal clean-diff gate | Removed |
| High | Return visits reconciled planned quantity per visit instead of across the physical chain | Completed/disposed planned work could be offered or counted again on a return | Reconciled planned work root-to-tip and blocked immutable scope drift |
| Medium | Office Review froze report identity/readiness but not its canonical section content | Office could not review the immutable technical record that was actually submitted | Frozen normalized checklist, measurements, findings, free text, photo/voice references and customer acknowledgement into each revision |
| Medium | Next production build used child-process workers unavailable on the constrained Windows host | Build compiled but the required typecheck/page-generation gate ended with `spawn EPERM` | Kept validation active and moved it to one worker thread; standard production build now passes |
| High | Firestore allowed any active Technician to read known foreign Work Order/Field IDs; Storage lacked canonical `field-evidence` access and its Legacy namespace allowed any authenticated user | Direct Firebase access contradicted the server assignment boundary and valid canonical uploads were denied | With explicit human authorization, added assignment-aware Firestore/Storage guards, canonical immutable media rules and executable assigned/unassigned/Office evidence |

No unresolved correctness, authority, source-of-truth, idempotency or data-loss defect was found in the reviewed range by the Builder review lenses. This statement is not independent Reviewer approval.

## Pass 1 — correctness and data loss

Solo Maintainer result: **PASS for correctness; no external reviewer claim is made**.

- Server completion rejects incomplete required frozen report sections.
- Professional Report remains a derived read projection and does not become Office Review.
- Planned quantities remain immutable while actual assets/interventions and dispositions reconcile independently.
- Return visits create distinct physical WorkVisits; Office Review freezes immutable linear-chain revisions.
- Inventory/Billing candidates are deterministic, immutable, replay-safe and contain no movement/invoice effects.
- Offline uncertain writes retain exact request identity and never display queued state as committed canonical truth.

## Pass 2 — architecture and security

Solo Maintainer result: **PASS at server and Rules perimeter**.

- Server is the only mutation/capability authority; UI consumes strict server projections.
- QR remains optional for registration; required A/C technical identity and three reference/plate photos remain enforced.
- Known-ID unassigned and foreign Customer/Property access paths fail closed in server tests.
- No shadow catalog, history database, report authority or browser-local production truth was introduced.
- Firestore 5/5 groups and Storage 16/16 direct-runtime scenarios prove assigned/participant/Office access and unassigned/inactive/anonymous denial. Canonical evidence is immutable to client replacement; the Legacy bypass is closed.

## Pass 3 — integration and regression

Solo Maintainer result: **LOCAL PASS; REMOTE CI NOT CURRENT**.

- Field core: 346/346 PASS using the exact CI test manifest in-process.
- Field extensions: 47/47 PASS, including Office Review 18/18.
- Booking/Scheduling regression: 94/94 PASS.
- Mandatory domain and offline acceptance: PASS.
- ERP Next typecheck and 14 Field security/transport contracts: PASS.
- Firebase static validation: PASS.
- Assignment-aware Rules: Firestore 5/5 groups PASS; Storage Rules Runtime 16/16 scenarios PASS.
- The native parallel Node test runner is blocked on this Windows host by `spawn EPERM`; the exact manifest passes 346/346 in-process. Next production build now passes completely with validation kept active in worker-thread mode.
- Remote `origin/feature/technician-portal-canonical-foundation` is behind the reviewed head because this host currently has no usable GitHub credentials. Therefore new GitHub workflow results cannot yet be claimed.

## Pass 4 — production readiness

Solo Maintainer result: **NOT YET PASS**.

Remaining conditions:

1. Current remote CI after an authenticated push.
2. Human UAT and merge approval remain release boundaries after engineering completion.

No merge, deployment or production mutation is part of this review packet.

## Review decision

- Correctness/architecture/integration lenses: PASS under Solo Maintainer Review Mode; this is not described as independent review.
- External reviewer absence: not a blocker and not `NEEDS_HUMAN` under current-main policy.
- Engineering readiness: **HOLD** until current-head remote CI and the final fresh adversarial pass complete.
- Release/merge readiness: **HOLD** until human UAT and merge approval; production deployment remains separately prohibited.
