# Audited corrections of operational receipts

Owner requests and standing release authorization: 2026-10-20. Deep Review, existing Office authority (OPS-SCHED-CHARGES-001/002). QBO remains the accounting source of record.

The operator selects only a payment date. New inputs carry an Aruba calendar day (`receivedDate`) and compatible ISO `receivedAt` at the start of that day. Actual `createdAt`, correction `updatedAt` and event `at` are server timestamps, never supplied by the operator. Existing timestamp-only receipts retain their exact timestamp when their day is unchanged. No history migration/backfill.

`correct_appointment_payment` changes the same office-recorded receipt with a required reason. All receipt values, amount representations, received-total delta, appointment version and append-only event commit in the existing transaction. Original identity, creator/time, status and payment count remain. Event `paymentBefore`/`paymentAfter` are separate from the pre-existing quote `before`/`after` contract. Linked, reconciled, allocated, inconsistent and voided receipts cannot be corrected by this command. Current authorization, edit lease, version, exact replay and reference uniqueness remain mandatory.

The client uses the same payment form and captures its financial version upon opening. It preserves unsaved work and blocks conflicts. An uncertain correction retains its exact request through reload/sign-out just like a registration; it is never reissued with a new request ID. The server advertises paymentCorrections only after the compatible code is active. UI history shows before/after, reason, actor and Aruba timestamp; the existing latest-100 window remains explicit and older audit events are never deleted.

Release replaces only appointmentCharges.js in the audited live Office package. Runtime config, IAM, all other source files and dependency lock remain unchanged. Backend is deployed first; the frontend uses an isolated production-baseline branch and is separately integrated into main.

Rollback must retain the correction-aware backend and pending-request decoder while disabling new correction entry if needed. Reverting directly to the old frontend can leave an uncertain correction envelope unreadable; never discard it. Deploy a correction-aware UI or replay the original request under the same authorized user to recover. An application rollback never rewrites receipt data or audit events. The private previous backend source is retained for investigation, not a license to remove support for pending corrections.
