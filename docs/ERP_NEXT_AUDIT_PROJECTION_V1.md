# ERP Next — Audit Projection V1

## Objective

Validate cross-module traceability immediately while keeping a strict distinction between browser-derived preview events and the immutable production AuditEvent trail that will be written through authenticated Firebase/server transactions.

## Requirements

- AUD-PREV-001 — Source business transactions project into a chronological audit view.
- AUD-PREV-002 — Audit projection retains timestamp, module, action, entity type and entity ID.
- AUD-PREV-003 — Financial and sensitive events are visually distinguishable from normal operational events.
- AUD-PREV-004 — Search and filters can narrow events by module, importance, entity/action/actor/detail.
- AUD-PREV-005 — Browser actor labels are explicitly marked as inferred preview context and are not authoritative identity evidence.
- AUD-PREV-006 — Production AuditEvent writes must use authenticated user identity or a controlled system actor rather than browser labels.
- AUD-PREV-007 — Production audit records are append-only/immutable; corrections create new events rather than rewriting prior evidence.
- AUD-PREV-008 — Source records remain authoritative for Work Orders, inventory, billing, payments and communications; Audit Log is evidence/history, not transactional truth.
- AUD-PREV-009 — Hard deletion of critical audit evidence is prohibited.
- AUD-PREV-010 — Production events must use durable database/server timestamps and retain before/after or transaction context where required.
- AUD-PREV-011 — Audit projection currently covers Scheduling, Work Orders, exact equipment scope, Field, Office Review, report delivery, Inventory consumption, Billing, detected Payments and Payment Allocations.
- AUD-PREV-012 — Production audit must support role-restricted access and sensitive-data redaction where appropriate.

## Current preview sources

The Audit projection reads browser-persistent business records and derives display events; it does not write duplicate audit records.

Actor examples such as `Office / Preview`, `Technician / Preview` and `Finance operator / Preview` are workflow labels only.

## Production architecture

Authenticated command
→ business transaction
→ authoritative record/ledger change
→ append-only AuditEvent
→ Audit Log / investigations / compliance reporting

A production AuditEvent should include at minimum:

- event ID
- occurred/server timestamp
- actor user ID or controlled system actor
- actor role/session context where appropriate
- action
- entity type / entity ID
- module
- before/after summary or transaction facts for sensitive changes
- correlation/command ID
- source/integration when external
- relevant IP/client metadata where legally and operationally appropriate

Production auditing must never depend solely on client-side localStorage.