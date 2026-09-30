# Review: Project browser preservation and Scheduling drawer readability

## Review mode

- [x] Independent Review (cross-review by separate agents for the two implementation areas)
- [ ] Solo Maintainer Adversarial Review

Reviewers: Scheduling readability agent reviewed Projects persistence; Projects preservation agent reviewed Scheduling typography. Each reviewer inspected code they did not implement.

## Scope reviewed

- Request/acceptance: avoid a repeat of silently missing browser-only Projects and make New Appointment guidance readable without changing booking/capacity behavior.
- Diff: `project-record-sanitizer.ts`, New Appointment drawer CSS/TSX, focused acceptance tests and task record.
- Affected callers: `loadSharedProjects`, `commitSharedProjects`, Projects workspace, `SchedulingPageShell` and the drawer.
- Authorities: shared Project writes remain under `projectAuthority`; Booking Authority paths are unchanged.

## Findings

| Severity | Location | Evidence and impact | Resolution |
| --- | --- | --- | --- |
| High, resolved | Drawer CSS | Scheduling's ancestor `!important` typography overrode the first local font increase, so the user's miniature-text complaint would persist. | Added drawer-scoped higher-specificity `!important` minimums and checked actual computed sizes in a browser fixture. |
| High, resolved | Project sanitizer | Exact sample IDs could contain user edits; filtering them during any save could irreversibly remove browser-only work. | Persistence now retains every original well-formed hidden row while reads may hide known sample IDs. Added both direct-save and commit regressions. |
| Medium, residual | Project read diagnostics | Malformed/inaccessible browser storage can still appear as zero visible Projects without an explicit recovery warning. | Writes fail closed; a separate recovery UX is needed. No claim of reconstructing records previously overwritten by deployed code. |
| Medium, release condition | Domain origins | `www` and apex serve the same ERP code but have separate browser storage and sessions; a redirect could strand unsynced drafts/offline work. | No redirect in this PR. Inventory/reconcile both origins and approve a controlled cutover separately. |

## Verification

- Required checks run: Projects acceptance, live Scheduling acceptance, ERP typecheck, ERP production build (including prebuild gates), `git diff --check`.
- Results: local checks passed on the final implementation tree. Browser CSS fixture with actual Scheduling ancestor and drawer styles computed 12px labels/help and 14px inputs; local ERP pages loaded without a page error overlay. Authenticated full drawer visual review remains pending.
- Security/permission cases: no authorization policy or backend endpoint changed; invalid/legacy browser state blocks mutation.
- Business-invariant cases: existing Projects are retained on write, including edited sample-ID rows; Booking Authority and capacity code are unchanged.
- Retry/concurrency/idempotency cases: existing `navigator.locks` Projects mutation route remains; this patch does not change backend request IDs or booking retries.
- Failure/recovery cases: corrupt JSON, unknown version and malformed rows prevent local persistence; reads never rewrite storage. Original live Project was published by the owner only after an existing 15-link dry-run; the owner confirmed its Scheduling card shows the Project name.
- Unverified areas: apex Projects list/search confirmation from owner, authenticated visual drawer review and all other operators' browser/offline data across both origins.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up for a draft preview only
- [ ] Block / changes required

Residual risk and owner: do not merge/deploy the typography change without owner visual approval; do not configure a production domain redirect until browser-only records, offline outboxes and sessions are reconciled for all affected operators. Domain migration requires a separate owner-approved plan. No production config or customer/booking record was changed by this code review.
