# ADR: Governed visit service pricing and exclusive financial editing

- Status: Proposed (owner-approved behavior; production release blocked)
- Date: 2026-10-12
- Owners: DEMAC business owner; ERP engineering
- Rule: OPS-SCHED-CHARGES-001
- Related task: ../tasks/appointment-finance-governance-20261012.md
- Refines: appointment-operational-charges-20261010.md, only new-line manual pricing behavior

## Context and decision

The owner clarified that service + BTU determines price. New concepts resolve canonical company/catalog tariffs; submitted arbitrary unit prices are rejected even with a reason. The server assigns canonical service names. Existing server snapshots retain historical labels/prices when their full line/service/BTU identity is unchanged. Changing service replaces that line; separately added lines are additions. Original estimates and receipt history remain immutable.

Use `appointments/{id}/chargeEditing/current` only for coordination, with authenticated owner, per-activation session, generation token and 90-second server expiry. The existing financial transaction validates lease and expected version together. Acquire only while the authorized operator has Importes y pagos visible, as requested; history, prefetch and read-only roles do not acquire. Renew every 25 seconds while visible; focus resumes renewal. Leaving releases best-effort, expiry recovers lost browsers. Recovering an unknown acquisition reuses the same activation ID. Drafts retain their version across loss/recovery.

Fresh authorization is always checked. An already committed exact receipt retry resolves before the lease test to avoid duplicate payments after lost responses. New requests still require ownership. Existing roles, QBO authority and technical completion/capacity behavior are unchanged. Existing client rules deny direct financial coordination access. Catalog enforcement additionally requires the reviewed services write-rule cutover.

## Alternatives and consequences

A visual-only lock cannot prevent simultaneous writes; an indefinite lock strands disconnected operators; a user-ID-only lock fails to distinguish two tabs. The chosen session/generation lease addresses these failures, with periodic coordination requests only while the tab is active. Expected versions remain necessary even with a lease. Auditors can read concurrently.

The same Office facade governs catalog writes with the existing admin/office/supervisor roles and admin/supervisor deletion policy. `services` remains the only catalog. Full-document hash plus random revision prevents stale overwrites including legacy records without a revision; immutable per-version audit enables exact replay. Private code claims serialize booking identity, using the booking consumer's legacy semantics. A private identity marker prevents deleted IDs from being reused. Linked work, Field interventions/sales and stock block deletion; deactivation preserves references. New direct client writes are denied only at coordinated cutover.

Blank catalog prices are null (unpriced); only explicit zero is free. Customer product projections, reservations and Inventory preserve this distinction. They must be published before unpriced writes are activated. Legacy catalog reads run independently from operational hydration, and confirmed mutations invalidate older read responses. Existing saved pricing settings are not a migration target of default changes. Their controlled update, preserving duration and unknown fields, is a separate release prerequisite.

## Verification and rollout

See task and review evidence. Production release remains blocked by effective tariff verification, all-consumer runtime/recovery checks and coordinated client cutover. PR #570 supplied an owner-approved reconstructed dependency baseline, but its resumed publication failed and actual live state still requires verification. Validate a coordinated frontend/backend release and forward recovery against fixed dependencies first. Old frontend clients fail closed on new monetary writes and need reload; do not claim an uninterrupted rollout until the compatibility plan is tested. Reverting only the frontend is insufficient. Preserve every financial/operational document during recovery; coordination may expire naturally.


### Cutover race and concurrency revision

Independent review reproduced an old financial transaction that commits after a new
lease is granted. Each fresh grant now atomically increments `jobCharges.version`
alongside the private lease, making that old transaction retry and reject its stale
expected version. Existing amounts, originals, final values, receipts and charge events
are preserved exactly. Missing state becomes the canonical empty schema; this is not
an estimate, receipt or monetary event. Financial version is a concurrency revision,
not a count of financial events. Renewal, denied acquisition, same-token retries and
release do not increment it.

The grant returns its protected version. The client waits for any older read flight
and, if needed, reads again before enabling monetary controls. Existing drafts retain
their original expected version and display a conflict on reacquisition; they are never
silently rebased. Exact committed retries remain valid without duplicate writes.
The actual appointment notification trigger ignores the version-only change.
