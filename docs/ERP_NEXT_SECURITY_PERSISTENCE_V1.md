# ERP Next — Persistence & Security Foundation V1

## Objective

Make ERP Next ready to replace structured preview data with real persistence without allowing Firebase, QuickBooks, Meta, OpenAI, banking or any other provider to define DEMAC's business architecture.

## Security requirements

- SEC-001 — Authorization uses explicit business capabilities, not UI visibility alone.
- SEC-002 — Roles have a least-privilege default capability set.
- SEC-003 — Navigation, application services and database rules form independent authorization layers.
- SEC-004 — High-risk actions require explicit approval and elevated capabilities.
- SEC-005 — Financial/bank/payroll/audit data has stronger access constraints than ordinary operational data.
- SEC-006 — Technician access is restricted to field execution and work context required for assigned jobs.
- SEC-007 — Deactivation removes effective access without deleting historical actor identity.
- SEC-008 — Sensitive configuration and permission changes generate audit events.
- SEC-009 — Secrets never live in browser source, product docs or audit payloads.
- SEC-010 — Destructive deletion is avoided for auditable business records; archive/corrective-event patterns are preferred.

## Persistence requirements

- DATA-001 — Business services depend on repository contracts rather than Firestore SDK calls scattered across screens.
- DATA-002 — Repository writes preserve created/updated actor and timestamps.
- DATA-003 — Sensitive updates support concurrency/version checks where practical.
- DATA-004 — Multi-record business operations use a governed unit-of-work / transaction boundary.
- DATA-005 — Immutable ledger/event collections are append-oriented.
- DATA-006 — Provider/external IDs are metadata and do not replace internal entity identity.
- DATA-007 — Environment configuration exposes provider/status but never secret material.
- DATA-008 — Production write authority remains disabled until security rules and adapters are validated.
- DATA-009 — Audit events carry actor, action, entity, module, correlation ID, reason and before/after context where appropriate.
- DATA-010 — Preview repositories and Firebase repositories implement the same contracts so UI/business logic does not branch on provider-specific behavior.

## Roles defined

- Owner / Super Admin
- Operations
- Office Operator
- Finance
- Warehouse
- Sales
- Project Manager
- Technician
- Auditor

## Capability domains

- Dashboard / KPI
- CRM / Sales
- Scheduling / Work Orders / Field Execution
- Communications
- Inventory / Purchasing
- Finance / Banking
- Employees / Payroll-sensitive information
- Projects / Reports
- Executive AI
- Settings / Automations / Integrations
- Audit / Security administration

## High-risk controls

The following remain explicit-approval actions even when AI or automation can prepare them:

- bank transfers
- refunds / credits / write-offs
- journal entries
- payroll-sensitive changes
- destructive deletes
- large purchase approvals
- material permission/security changes

## Current runtime state

- UI: live ERP Next
- data provider: structured preview data
- production Firebase writes: disabled/not connected
- external provider writes: disabled
- Firebase Console changes: deferred until adapter/rules/index review

## Next implementation checkpoint

1. Firebase client/auth adapter contract
2. Authenticated principal/session provider
3. Firestore repository adapter for CRM core
4. Security Rules draft mapped to capabilities
5. Storage/evidence path model
6. audit writer adapter
7. migrate one vertical slice end-to-end before converting the remaining modules

Recommended first vertical slice:
**Customer → Contact → Site → Asset** because Scheduling, Work Orders, Communications, Estimates, Invoices and Maintenance all depend on that identity graph.
