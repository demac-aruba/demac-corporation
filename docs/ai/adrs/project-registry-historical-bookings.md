# Project registry and historical booking corrections

Status: implementation in progress under explicit owner authorization.

The historical cancel-and-replacement design below is superseded for **new corrections of confirmed bookings** by `project-in-place-slot-correction.md`. Existing replacement records remain readable. `history_preview` and `history_confirm` are retained narrowly to recover a Project booking already cancelled before the new in-place workflow; the new UI does not cancel a confirmed booking to invoke them. The Project registry and explicit import decisions in this document remain applicable.

Browser-only Project identity cannot safely authorize historical bookings or survive another session. Introduce server-owned `projectRecords` for planning metadata and canonical booking links. It does not become an authority for attendance, payroll, invoices or Field actuals. Existing browser records are imported only by an explicit owner action after validation; a dry run precedes import and the local copy remains recoverable.

The service uses fresh provisioned user roles, optimistic record versions, unique number/link claims and bounded payloads. Direct client Firestore access is not added. Planning phases and bounded assignment links remain embedded for the current small portfolio; record and array limits fail explicitly rather than silently truncate. A later subcollection migration is required before these limits are reached.

Historical replacement uses a cancelled canonical appointment and its recorded Work Orders as evidence. It is limited to a subset of the original occupied capacity and preserves the recorded crew. Unverifiable histories fail closed. Existing Booking Authority atomically creates the new appointment, Work Orders, locks and Project link; a unique source correction claim prevents two replacements even with different retry keys. Audit records are append-only service writes. Reversals use existing cancellation, not deletion.

Rollback: leave shared records and booking links intact, roll back application code, and disable the new API if necessary. Never restore a cancelled original automatically. An interrupted import or save can be retried with the same request identifier. No production data rewrite is part of deployment.
