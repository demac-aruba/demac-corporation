# ERP Next — Field Execution → Office Review Persistence V1

## Objective

Continue the persistent operational chain from a Scheduling-created Work Order into technician execution and office quality review without creating a disconnected technician record.

## Field execution requirements

- FIELD-PERSIST-001 — A browser-created Work Order can be opened directly in the technician execution workspace.
- FIELD-PERSIST-002 — Work Order customer, property, CRM IDs, assigned vans, customer-facing scope and technician-only instructions are inherited.
- FIELD-PERSIST-003 — Technician progress persists across browser refreshes.
- FIELD-PERSIST-004 — Equipment execution state is independent per asset/unit.
- FIELD-PERSIST-005 — Before and after evidence is tracked independently per equipment record.
- FIELD-PERSIST-006 — Gauge/refrigerant evidence remains equipment-specific.
- FIELD-PERSIST-007 — Add-ons/materials are captured before report submission.
- FIELD-PERSIST-008 — Voice duration is capped at 120 seconds; transcription status does not block other field progress.
- FIELD-PERSIST-009 — A technician summary remains the original field narrative alongside future professionalized output.
- FIELD-PERSIST-010 — Field submit gate blocks incomplete equipment, missing before/after evidence, or voice longer than 120 seconds.

## Office review requirements

- REVIEW-PERSIST-001 — Submitting field execution creates one linked Office Review record.
- REVIEW-PERSIST-002 — Technician submission never automatically sends a customer report.
- REVIEW-PERSIST-003 — Office sees original technician summary and professionalized customer summary separately.
- REVIEW-PERSIST-004 — Office can choose English, Spanish or Papiamento customer-report language.
- REVIEW-PERSIST-005 — Office can add a review note and either Approve or Return for Correction.
- REVIEW-PERSIST-006 — Approval means ready for human delivery; it is not customer delivery itself.
- REVIEW-PERSIST-007 — Repeated field submission does not create duplicate Office Review records.

## Current browser persistence

- field execution: `demac.erp-next.field.executions.v1`
- office review: `demac.erp-next.office.reviews.v1`

This remains test-only browser persistence until Firebase data mode is activated.

## Equipment identity limitation

For the current checkpoint, a CRM-linked Work Order loads equipment from the selected customer's property graph when available. If equipment is not registered, the field flow creates temporary unit placeholders so the execution workflow can still be tested.

The next equipment-scope checkpoint should let Scheduling/Work Order select the exact registered HVAC assets to be serviced rather than inferring them from quantity alone.
