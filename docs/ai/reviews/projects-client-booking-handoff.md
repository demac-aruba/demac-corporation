# Adversarial review: client-to-Booking handoff checkpoint

Mode: Solo Maintainer Adversarial Review by ChatGPT (implementation author), not independent.
Scope: the new client contract, its focused/emulator tests and additive existing CI gates.
Owning contracts inspected at a24df06: registry DTOs, Booking request/draft normalization,
Office availability/confirmation types, atomic Project commit adapter and Office emulator tests.

## Findings and disposition

1. A project-only match would accept a receipt for a different offer/option. The prepared
   expectation now includes offer ID/version and selected option ID; verification requires
   agreement with the actual canonical Appointment fields. Regression cases cover each.
2. Picking only the first Work Order would lose support/return allocation in the handoff.
   Verification requires non-empty unique sets matching the Appointment's complete list,
   returns a copied complete list and flags an inconsistent response as uncertain.
3. A hold may be promoted before the original creation request is replayed. A confirmed
   result is accepted for a requested hold only as a replay, preserving the original identity.
4. Keeping mutable input references could change evidence while awaiting a response.
   Input, selection and confirmation expectations are JSON snapshots; tests mutate originals.
5. A new create helper must not process rescheduling/cancellation/operational moves. Such
   existing-appointment inputs are rejected; their existing lifecycle authority remains intact.

No server authorization, provisioning, capacity, transaction, idempotency, budget baseline,
authentication storage, CORS/security or operational writer was changed. Types are imported
from the established client contracts rather than a second independently implemented API.
Client checks are correlation safeguards, not authoritative availability or permission checks.
Request-generation/epoch handling and exact pending-command persistence belong to the existing
UI caller and must be preserved when the adapter is wired there; they are NOT newly completed.

Local verification: actual TypeScript module executed under Node 22.16.0 type stripping;
18 tests passed, zero failed/skipped. Type stripping is NOT TypeScript typechecking. Exact-head
full TypeScript/build and actual emulator execution are mandatory CI gates and their completed
results must be recorded in the PR before claiming those passed. Emulator source syntax passed.
The full runtime provider and multi-user load are not simulated by the new narrow fixture.

Disposition: commit as a bounded development increment; keep Draft/no merge. The active drawer
still uses the current path. No real Project backup, reconciliation, migration or production
activation has occurred. Existing required checks were added to, never waived or weakened.
