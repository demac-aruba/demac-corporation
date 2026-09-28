# Task: preserve local Projects and restore readable Scheduling guidance

## Context

- Request/source: the owner reported a previously created Project missing from Projects search/list on the apex domain, its linked Scheduling card showing a generic work label, and unreadably small New Appointment guidance.
- Product surface and users: ERP Next Projects and Office Scheduling operators.
- Current behavior/evidence: apex and `www` serve identical ERP HTML, but browser storage is origin-scoped. One original Project existed only in the owner's `www` browser storage; the owner's dry-run verified 15 canonical booking links, then the owner published that original Project through the existing shared save flow and confirmed its Scheduling card now shows the Project name. No appointment or customer was recreated.

## Scope

- In scope: prevent Projects reads or writes from silently discarding browser-only records; raise the New Appointment drawer's helper, placeholder and input text to readable sizes without changing Booking Authority behavior.
- Out of scope: DNS/domain redirect, automatic cross-origin browser storage migration, backend Project model changes, booking/capacity edits, technician app, real customer test fixtures.
- Files/boundaries expected: `project-record-sanitizer.ts`, New Appointment drawer styles, and focused acceptance tests. Production data remains under existing authorities.

## Governance

- Authority owner(s): `projectAuthority` owns shared Projects; Booking Authority owns Appointments, Work Orders and capacity. Browser-only records are recovery inputs, not a second shared authority.
- Business-rule IDs: existing OPS-SCHED and Project identity/link rules; no new business rule.
- Security/privacy impact: no new permission or public data route. Keep failure closed when local Projects cannot be safely preserved.
- Legacy parity impact: none.
- ADR/debt impact: no architecture change in this patch. A domain consolidation requires a separate audited migration/rollback decision because authentication, drafts and offline data are origin-scoped.

## Acceptance criteria

- [x] Reading Projects never rewrites local storage.
- [x] Saving a Project preserves every existing well-formed local record, including known sample IDs that may have been edited; invalid/legacy storage blocks the write instead of dropping records.
- [x] Scheduling's actual wrapper cannot override the drawer's minimum readable text sizes.
- [x] Existing Scheduling and Projects tests, typecheck and ERP production build pass.
- [ ] Owner confirms the Project appears in apex Projects/search and visually reviews the drawer preview before any merge.

## Plan and risk

- Implementation outline: narrow browser storage guards and drawer-local typography overrides; no Booking Authority or Firestore write-path changes.
- Migration/rollback or recovery: the owner used the existing dry-run and shared save for the one original Project; no code-driven migration. Reverting this patch returns prior rendering but does not remove the shared Project.
- Key risks and mitigations: a global Scheduling `!important` rule can mask local font overrides; verify specificity. Origin redirect can strand browser-only business drafts or sessions; do not redirect without a per-origin inventory and explicit owner-approved rollout.

## Verification

- Automated gates: Projects and Scheduling acceptance, typecheck, and ERP production build passed; browser CSS fixture computed 12px helper/label and 14px entry text under the actual ancestor rules.
- Manual scenarios: owner's shared Project publication and Scheduling label confirmation completed; apex Projects/search and authenticated drawer visual check pending.
- Evidence/results: identical apex/`www` ERP response bodies; original Project remained in `www` browser storage, and the owner verified its canonical links before publishing. No live Appointment, CRM, or capacity mutation by this patch.
- Not run and why: cross-operator origin inventory and redirect are separate high-risk production work; unauthenticated local browser cannot render the private New Appointment drawer.
