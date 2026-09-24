# Technician App: catalog service selection increment

## Scope and source

Continue PR 526 on `feature/technician-app-20260923`, based on
`bfe2395d550c23a9e38e2c16ff133bab31d3215b`. The owner requires functional
and visual preview review before merge/production. Keep Draft. This UI increment
uses Fast Product Validation; future shared ownership, permission changes and
safety coordination still require Deep Review. No production writes are included.

## Implemented presentation

Replace the existing planned/additional service dropdown surfaces with explicit
native-radio cards: select the exact VisitAsset, the office-planned work line
(where applicable), and an available canonical catalog service. A separate Save
button invokes the unchanged controller. Selection is not arrival, execution,
completion, customer approval, billing or inventory movement.

The selection is revalidated against current server options on every render.
No default service, scope origin, condition or price is invented. Per-air UI
choices survive a panel round trip or a reported save error. Changing work/visit
context remounts these drafts. They are **not** persistent offline binary drafts
and are not described as refresh-safe unsaved data. Existing parent mutation
locks, request IDs, cache read-only behavior, API validators and backend audit
remain authoritative. Existing intervention history and planned-not-performed
reconciliation controls remain intact.

The additional form is a service proposal, not the finished Products/add-on
catalog from references 09/10. Its existing required origin and explanation are
preserved. Neither the UI nor this increment expands helper permissions.

## Reference mapping and differences for owner review

| Reference | Increment | Remaining difference |
| --- | --- | --- |
| 03 service selection | Blue/white tactile service cards, selected state, air context, explicit save | Currently embedded under the existing Service > Trabajo y materiales disclosure, not a dedicated full-screen step. The canonical office line is explicit; catalog labels are not replaced with illustrative mockup options. |
| 04 indoor/outdoor | Integration boundary identified at the saved WorkIntervention | Shared part selection is not implemented. No local ownership or duplicate billable services were created. |
| 09/10 add-ons | Existing additional-service proposal receives the same reusable selection controls | Product sales and decision/execution workflow remain the existing controls; the requested replacement layouts are not complete. |

The existing DEMAC header, identity, property context and navigation are unchanged.
At 360px service cards use one column for legibility; wider widths use two. All
labels remain native keyboard-accessible controls and tolerate long catalog text.
This layout difference is submitted for owner review, not treated as approved.

## Verification

Local focused strict TypeScript check of the modified components/fixture passed.
Real Chromium component tests passed at 360x800, 390x844 and 1365x1000, covering
explicit choices, exact callback IDs, no mutation on selection, duplicate/escaped
labels, per-air state, context reset, revoked options, busy/error states, empty
catalog, keyboard, tactile target size, no overflow and zero network requests.
These component fixtures are synthetic and never imported by an app route.

The branch-only isolated review workflow keeps every existing gate and adds the
new component tests plus an authenticated compiled-app test. The latter must
verify one saved planned intervention, unmodified office scope, confirmed rather
than performed status, exact replay, reload persistence and public HTTPS reads.
It records separate public/loopback reports. **Remote integration results are
pending at implementation time; consult the exact-head PR run for final status.**

The temporary review recipient public key is refreshed for this owner session;
its private key never enters the source, CI or logs. Other existing encryption
recipients remain untouched. This is not a Firebase credential/permission change.

## Remaining work and rollback

Hito 1 is still in progress: shared indoor/outdoor selection is outstanding.
Hitos 2/3 still need versioned 14/9 procedures, scoped concurrent part ownership,
safety coordination, persistent multimedia outbox, anomalies, add-ons and global
review/closure integration. No current UI selection is a safety authorization.

This change adds no collection, contract, migration, price or security rule.
Reverting the source restores the previous form without deleting historical
interventions. No production migration or release has been performed.
