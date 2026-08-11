# ERP Next — Office-Approved Report Delivery V1

## Objective

Keep customer delivery as a separate governed action after Office Review. Technician completion and office approval must never silently become a customer message.

## Requirements

- DELIV-001 — Only Office Review records with status `approved` enter the customer-delivery queue.
- DELIV-002 — Pending/returned reviews are never eligible for delivery.
- DELIV-003 — Office explicitly chooses WhatsApp or email as the intended channel.
- DELIV-004 — Office may record the recipient/destination and an internal delivery note.
- DELIV-005 — Current browser preview uses **Mark Sent**, which records a human action only and does not call any external provider.
- DELIV-006 — One Office Review cannot create duplicate delivery records when processed again.
- DELIV-007 — Delivery record retains Review, Work Order, Appointment, customer, site, report language, channel and timestamp.
- DELIV-008 — Recently sent reports remain visible as delivery history.
- DELIV-009 — Approval means “ready for human delivery,” not “sent.”
- DELIV-010 — Future provider integration must preserve explicit command/audit authority unless DEMAC later approves a narrow low-risk automation policy.

## Browser preview persistence

Storage key:

`demac.erp-next.communications.report-deliveries.v1`

## Current provider behavior

No WhatsApp, Meta, email, PBX, OpenAI or other external send is triggered by this checkpoint.

## Future production flow

Field Execution
→ Office Review
→ Approved Report
→ Delivery Queue
→ explicit operator Send command
→ provider adapter
→ delivery receipt/status
→ CRM communication timeline / audit event

Provider errors must keep the delivery item actionable rather than falsely marking it sent.
