# Authority Matrix

Authority means the component allowed to decide and persist truth. UI state, AI output,
provider callbacks, and cached projections are never authority by themselves.

| Domain | Authoritative source/service | Allowed callers | Required controls |
| --- | --- | --- | --- |
| Identity and roles | Firebase Auth plus governed user/role records | Authenticated clients; admin functions | Token verification, server-side role checks, least privilege, audit |
| Customer identity | Canonical `Customer` record through CRM/domain services | Authorized office/operations flows | Stable ID, duplicate detection, merge/alias audit |
| Property identity | Canonical `Property` record linked to its Customer | Authorized CRM and scheduling flows | Stable ID, preserved history, no embedded duplicate identity |
| Contact identity | Canonical `Contact` record | Authorized CRM and communication flows | Stable ID, deduplication, consent and audit |
| Contact-to-Property responsibility | `contactPropertyAssignments` | Authorized CRM/communication flows | Explicit role/responsibility and effective configuration |
| Scheduling and capacity | Booking Authority and approved canonical company/calendar/capacity settings | Office tools, ERP Next, allowlisted AI tool | Commit-time revalidation, conflict prevention, idempotency |
| Work-order lifecycle | Work-order application service | Assigned/authorized roles | Valid transitions, evidence rules, actor/time audit |
| Pricing and service duration | Approved company rule/settings hierarchy | Read consumers; authorized settings editor | Rule version, effective date, no AI invention |
| Employee master identity | `staffProfiles` | Authorized workforce/admin flows | Firebase users remain authentication identities, never a duplicate employee master |
| Dated staff unavailability | `staffAbsences` | Authorized workforce/operations flows | Vacation, sickness, and one-off dated ranges only |
| Technical recurring half-day | `vanHalfDaySchedules` for the Van/team | Authorized operations/scheduling flows | Technical staff inherit the Van/team rule; no employee-level duplicate |
| Office/non-technical recurring half-day and payroll schedule | `employeePayrollSettings` | Authorized workforce/payroll flows | Payroll permission boundary and employee linkage |
| Temporary crew override | `dailyVanAssignments` | Authorized operations/scheduling flows | Date-scoped override; does not rewrite recurring crew ownership |
| Inventory | Inventory Authority over the append-oriented inventory transaction ledger | Warehouse/authorized work-order flows | Atomic movement, no direct balance edits, reconciliation |
| Operational finance records | DEMAC ERP governed operational workflows | Finance roles and verified integrations | Operational traceability; no competing accounting balances or books |
| Accounting books | QuickBooks Online, the planned/official accounting system of record, through a governed integration | Authorized finance integration | No parallel accounting engine, duplicate official numbering authority, or competing reconstruction of QBO history |
| Transactional WhatsApp | Communication authority using canonical provider configuration; current default is `wacli` | Governed producers and the configured transport adapter | One queue/sender/contact model/notification authority; another provider such as Meta requires explicit canonical configuration |
| AI actions | Allowlists and domain tools | Approved agent runtimes | Risk tier, explicit approval where required, bounded inputs, audit |
| External provider state | Provider adapter, translated into canonical records | Verified webhook/poll workers | Signature/auth verification, replay protection, raw-event trace ID |

## Conflict rule

When two sources disagree, do not use recency alone. Prefer the designated authority,
record the discrepancy, and require reconciliation before a high-impact write.

## Identity and communication history constraints

- Historical recipient snapshots record what was sent to whom at that time. Later Contact
  or `contactPropertyAssignments` changes must not rewrite those snapshots.
- Legacy embedded property contacts are compatibility fallback only. They must not become
  a second canonical Customer, Property, Contact, or communication-responsibility model.
- Browser/localStorage and `browser-*` operational records are preview, compatibility, and
  non-canonical unless a specific approved architecture document explicitly designates a
  particular record as canonical.
- Booking Authority is the commit-time scheduling authority. Suggestions, rendered agenda
  state, caches, browser models, and AI output may not commit around it.
- No agent may introduce another WhatsApp queue, sender, contact model, or notification
  authority without an approved architecture decision and explicit human approval for the
  new source-of-truth boundary.

## Accounting boundary

DEMAC ERP owns operational workflows. QuickBooks Online is the planned/official system of
record for accounting workflows. ERP may reference, synchronize, present, and initiate
governed workflows through the QuickBooks integration, but it must not become a competing
accounting engine.

Agents must not create inside DEMAC ERP:

- a parallel accounting engine or second accounting ledger/book of record;
- duplicate official invoice-numbering authority;
- duplicate official estimate-numbering authority;
- recreated historical QuickBooks accounting transactions as a competing source of truth; or
- independent accounting balances that compete with QuickBooks.
