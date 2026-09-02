# Technician Portal Firestore/Storage Rules evidence

Evidence date: 2026-08-28

## Scope and constraint

DEMAC explicitly authorized assignment-aware Firestore/Storage hardening on the feature branch. Commit `edc9f3899418a0ac665300625ffaea101d3cf844` changes only branch code and test evidence; it does **not** deploy Rules, merge the branch or mutate production. Any deployment remains a separate Human Approval Boundary.

The target is assigned-only Technician access at the database and evidence perimeter while active authorized Office readers retain governed access. The durable cross-emulator harness is `firebase/technicianPortalRules.test.cjs` and uses the canonical `field-evidence/{visitId}/...` registration, report-photo and voice paths. The former `work-orders/{workOrderId}/...` path remains covered as a Legacy bypass check.

## Firestore emulator result

Runtime: Cloud Firestore Emulator 1.22.0 with `@firebase/rules-unit-testing` 5.0.2.

| Check | Expected | Actual | Result |
|---|---|---|---|
| Anonymous or inactive technician reads assigned Work Order | DENY | DENY | PASS |
| Assigned technician reads assigned Work Order | ALLOW | ALLOW | PASS |
| Authorized Office user reads Work Order | ALLOW | ALLOW | PASS |
| Visit participant reads Visit-scoped data but not the Work Order without Work Order assignment | ALLOW / DENY | ALLOW / DENY | PASS |
| Active unassigned technician reads known Work Order, Visit or Intervention ID | DENY | DENY | PASS |
| Client fabricates `fieldOperationEvents`, `fieldOfficeReviews` or `fieldBillingCandidates` | DENY | DENY | PASS |

Executable result: **5/5 Firestore test groups PASS** in the in-process runner. The native Node parallel test launcher is denied child-process creation on this Windows host; this is the same host constraint already recorded for other exact-manifest runs and does not affect the in-process assertions.

The assignment-aware read guard now covers Work Orders, Work Visits, Visit Units, Interventions, Report Sections, Visit Add-ons, Equipment Systems, Work Order Units and Work Order Evidence. Non-Technician active-reader behavior is preserved; Technician access resolves persisted Work Order, Van or Visit participation/lead assignment and fails closed otherwise.

## Storage rules runtime result

Runtime: Cloud Storage Rules Runtime 1.1.3, loaded with the exact checked-in `storage.rules`.

The Firebase CLI cannot launch its Java child process in this sandbox, so the same official runtime was driven directly through its rules action protocol. This executes the compiled rules and Firestore document lookups rather than inferring outcomes from source text.

| Check group | Result |
|---|---|
| Assigned registration image create/read | PASS |
| Assigned report voice create | PASS |
| Visit participant canonical read | PASS |
| Authorized Office canonical read | PASS |
| Unassigned canonical read/create denial | PASS |
| Anonymous/inactive denial | PASS |
| Canonical replacement denial | PASS |
| Invalid media type and 12 MiB boundary denial | PASS |
| Assigned Legacy read/create retained | PASS |
| Unassigned Legacy read/create bypass denial | PASS |

Executable result: **16/16 Storage rule scenarios PASS**.

Canonical evidence creation is bound to current Work Visit assignment, validates image/audio type and size, and is immutable through client Rules. This matches the media-only upload endpoint, which does not attach custom metadata. The Legacy namespace retains uploader metadata checks but now also resolves Work Order assignment.

## Decision

The branch-level Rules deliverable is **PASS**. The prior missing canonical namespace, unassigned known-ID Firestore read and authenticated Legacy Storage bypass are closed with executable allow/deny evidence. Residual risk is limited to future deployment/runtime integration and human UAT; no production Rule has been deployed. Rules deployment remains `NEEDS_HUMAN`.
