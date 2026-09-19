# Projects client-to-Booking handoff contract

## Request, authorization and evidence

Christian asked to verify merge readiness and continue when work remains. The required
whole-module condition is not met. Work remains on feature/projects-canonical-integration,
PR #514; no main merge, production activation, data migration or new access is authorized.
Deep Review applies to this existing multi-module workstream.

Baseline a24df06849b26a193eeb1c4e1af064633b550841 already contains the dormant
`functions/projects/booking-integration.js` adapter, its atomic commit hooks in
bookingAuthorityFirestore, and Office injection. Do not recreate those authorities.
The missing client handoff must use those contracts, not call the browser-only link reducer
after successful booking. This increment prepares/verifies that client contract and tests
it against the existing actual Office API and Firestore/Auth emulators.

## Implemented boundary

`booking-handoff.ts` is dependency-free at runtime, using existing Office and registry DTOs.
It binds central Project ID/phase/current version to an otherwise unchanged Office request;
prepares the existing confirmation command with the caller's stable retry ID; and checks
the returned Project context, customer, property, offer/option and complete Work Order list.
It preserves all support-slot selections, descriptions and recipient settings. It does not
cap work at the estimate, raise the budget, produce actual labor or write storage/Firestore.
The Booking Authority still validates permissions, operational capacity and transaction locks.

A malformed/mismatched post-commit receipt is explicitly uncertain, not a false assertion
that nothing was saved. The calling workflow must retain the exact pending request and offer
rather than create a replacement. A recovered hold may already be confirmed; such a replay
is accepted without creating another appointment. Current-slot/lifecycle validation is not
duplicated by this adapter. Existing appointment edits are rejected from this create-only path.

## Acceptance and limits

Eighteen synthetic client-contract tests cover positive/negative binding and result integrity.
Three new real Auth/Firestore emulator cases use the actual client module and Office API
for confirmed/held allocation + exact retry and an intervening plan-version conflict.
The injected scheduling provider is a fixture, not a live real-capacity load test; existing
Booking/Field and combined PR #515 regression gates remain unchanged and required.

The active drawer is NOT switched in this increment. Integration into its established
Project picker, work-input/version signatures and pending-request recovery must occur together,
without replacing the modal/navigation behavior or creating a parallel booking interface.
The helper is only called by tests until that next bounded UI wiring is complete. Do not
claim the browser scheduling workflow is now central or ready for production.

Before release: complete Field time/progress, remaining phase/template/cost parity, actual
original-browser backup and cloud restore verification, historical reconciliation and final
combined cross-browser/operational regression. No actual client or appointment was read/written.
