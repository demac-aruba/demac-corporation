# Projects registry increment — implementation, not production activation

## Current scope

The owner requested continuing until Projects is complete and safe, with no production
merge while material work remains. This increment adds a dormant central planning service
and a consistent read of linked operational history. It does not replace the active UI.
No existing Scheduling, Field, CRM, Inventory, Finance or telemetry writer is changed.

The temporary read-only source archive workflow used for local inspection is removed.
It performed no deployment and contained no environment credentials or business records.

## Proposed planning ownership

`projectRecords` is the proposed central planning record, not an execution ledger.
`projectNumbers` enforces unique generated project numbers; importing existing identities
is a separate reviewed operation not implemented by create_plan. The create command must
never be used to replace a historical browser record or renumber an existing project.
`projectAppointmentLinks` is a unique appointment-to-project/phase relation, not a second
Appointment or Work Order. `projectEvents` contains append-only planning before/after
revisions. `projectCommandReceipts` binds one exact command to a provisioned actor for
idempotent retry. Existing CRM IDs, Work Orders, visits and Office Reviews remain authoritative.

The constructor defaults disabled. Runtime enablement plus the server-side
`businessSettings/projects-registry.backendEnabled` flag are both required. There is no
HTTP export, bootstrap/index modification, production deployment job or activation command.
Existing Firestore rules deny direct client access to these collections. Emulator tests
use those unchanged rules to challenge direct-client write bypasses.

## Implemented contracts

- Current provisioned active roles, aligned with the existing Projects capability set;
  role revocation is checked even when replaying a successful request.
- Bounded, strictly validated commands; immutable input captured before transaction retry.
- Version conflicts, unique identities, exact-payload retry receipts and atomic planning/audit
  writes. No side effects occur outside the transaction when a write fails.
- Metadata cannot rewrite CRM identity, actual labor, capacity, costs or execution status.
- Estimate revisions preserve the original Van-minute baseline and append explicit reasons.
  A forecast overrun is advisory and does not grant or deny Booking Authority availability.
- Phase dependency/cycle checks; phases with operational links cannot be removed.
- Explicit reviewed association of an EXISTING appointment. All current Work Orders must
  match the same Customer and Property. Conflicting associations cannot overwrite each other.
  This is a reconciliation command, not the future automatic booking handoff.
- Bounded/paginated activity reads load the current canonical Work Orders, so additional
  support, cancellation and rescheduling do not require copying mutable capacity counters.
- Field visit and Office Review projections reuse the existing Field identity/schema
  validators. Approval status is read from the existing frozen revision, not authored here.
- Planned Van minutes, actual person minutes and actual Van minutes remain distinct units.
  A page subtotal is never represented as a full-project budget. Unresolved quantities are
  null with coverage/reconciliation reasons, never a fabricated healthy zero.

## Verification and limitations

Local dependency-free tests: 56 pass, zero fail/skip. Runtime imports initialize no Firebase
SDK. The new integration suite is guarded to demo-demac-projects and loopback Auth/Firestore
only. Results must be verified in CI before this increment is represented as emulator-tested.
No real project, appointment or client is included in the fixtures.

Still required before whole-module release:
- Original browser backup and verified cloud data backup/restore process; real read-only
  reconciliation of the reported project. Neither has been performed by this increment.
- Full planning-schema compatibility/import preview preserving historical project/phase IDs,
  rich planning fields, templates and unknown legacy content. No blind JSON import.
- Connect the real Projects UI to the central service and complete the Booking Authority
  handoff without exposing a post-confirmation data-loss gap. The current UI still uses local data.
- Connect a governed measured-time source and phase completion evidence. Current Field visit
  timestamps alone do not establish pause-aware person-hours or physical completion.
- Material, expense and financial read models from existing authorities; no parallel ledger.
- Preview/browser/mobile acceptance for the full integrated flow, final joint regression,
  staging recovery drill and owner approval. The budget fix remains separately tested in PR #515.

## Review gates

Deep Review / Solo Maintainer Adversarial Review, never described as independent. Do not
weaken existing gates or claim no production risk. A successful isolated suite does not
prove the historical project has been migrated or the production integration is finished.
Keep PR #514 draft and main unchanged.
