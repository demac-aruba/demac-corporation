# DEMAC ERP Next — CRM Commercial Timeline V4

Status: In Development / pre-Firebase CRM completion.

## Purpose

Complete the CRM foundation with one governed relationship timeline, structured commercial opportunities and a capability model that can later be enforced consistently by UI, APIs and Firebase rules.

## Requirements

### CRM-026 — Unified relationship timeline
Customer communications, calls, field work, estimates, financial signals and internal notes appear in one chronological relationship timeline. Timeline entries reference canonical module records rather than becoming duplicate stores of business truth.

### CRM-027 — Internal notes are distinct from customer communication
An internal CRM note is never treated as a WhatsApp/email/customer reply. The UI and future persistence model must preserve this distinction so private operational context cannot be sent accidentally.

### CRM-028 — Every opportunity requires accountable follow-up
An opportunity carries an owner, stage, probability, next action and due date. A commercial item without a next action is considered incomplete operationally.

### CRM-029 — Technician recommendation conversion is intentional
A technician finding or recommendation may create a commercial signal, but it becomes an opportunity only through an explicit conversion action or approved automation rule. The original technician report remains unchanged.

### CRM-030 — Pipeline value remains measurable
The CRM may calculate weighted pipeline as expected value multiplied by probability. Forecasting must retain the original expected value and probability so the calculation is explainable.

### CRM-031 — Permissions are capability-based
Access control is not implemented only by hiding screens. ERP Next defines capabilities such as `crm.customer.edit`, `crm.customer.merge`, `crm.opportunity.manage` and `finance.full`. UI controls, server APIs and Firebase/security rules must eventually enforce the same policy.

### CRM-032 — Financial CRM context is permission-aware
CRM may expose customer-level outstanding balance or financial summary when the role has permission, while detailed finance operations remain restricted to finance-authorized capabilities.

### CRM-033 — Timeline events originate from canonical modules
Future production events are emitted by Communications, Scheduling, Work Orders, Estimates, Invoices, Payments, Documents and CRM notes. The timeline is a read model over those events, not an alternate ledger.

## Preview implementation

- Communications tab now renders a filterable unified activity timeline.
- Preview channels include WhatsApp, calls, work, bank/payment signals and sales activity.
- Internal-note composer is explicitly labeled internal-only.
- Opportunities tab contains structured opportunity cards, owner, stage, probability, expected value, next action and due date.
- Technician recommendation can be converted deliberately into an opportunity.
- Weighted pipeline is displayed from opportunity value × probability.
- Provider-neutral capability policy added in `apps/erp-next/lib/capabilities.ts` for all current ERP roles.

## Capability policy notes

The initial role matrix is a product baseline, not yet a production authorization implementation. Before Firebase integration:

1. validate final role names and staff assignments;
2. align server/API authorization with the capability list;
3. implement equivalent Firebase rules or trusted server-only writes;
4. add audit events for sensitive operations such as merge, finance changes and permission updates.

## Deferred questions

- final role naming shown to staff
- which office roles see Customer Health and detailed AR metrics
- whether sales can edit site/equipment data or only request correction
- automated opportunity ownership rules
- SLA rules for overdue next actions
