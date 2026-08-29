# Task: Link an existing CRM customer as a property contact

## Context

- Request/source: The owner confirmed that a person may remain an independent residential customer while also serving as the contact for a commercial customer's property.
- Product surface and users: ERP Next CRM Customer 360 for authenticated roles already authorized by the Office Booking Authority allowlist.
- Current behavior/evidence: `Add contact` accepted only copied manual identity fields and could not search or link a canonical customer profile.

## Scope

- In scope: Search active CRM customers from `Add contact`, link the selected customer to one or all properties, hydrate identity live, preserve role/communication rules, and keep the manual new-contact path.
- Out of scope: Automatic merging of existing manual contacts, production-data migration, customer/profile deletion, and changes to historical appointment recipient snapshots.
- Files/boundaries expected: ERP Next CRM components and live joins; Office Booking Authority and canonical contact-directory functions; focused acceptance and backend tests.

## Governance

- Authority owner(s): `clients` owns customer identity; `contacts` owns the relationship-local contact bridge; `contactPropertyAssignments` owns property role, scope, and communication responsibilities; Office Booking Authority owns writes.
- Business-rule IDs: No pricing or scheduling rule changes. This task enforces the Authority Matrix customer/contact identity and Contact-to-Property responsibility invariants.
- Security/privacy impact: Existing Office Booking Authority authentication and server-side office-role checks remain mandatory. Search results contain only CRM data already available to those roles.
- Legacy parity impact: None; ERP Next remains the intended CRM surface.
- ADR/debt impact: No new source of truth and no ADR required. The bridge stores a stable `linkedCustomerId` but no copied identity fields.

## Acceptance criteria

- [x] Given a commercial customer, when the operator opens `Add contact`, they can search active existing customers by name, company, phone, email, property, or address and select one.
- [x] Given a selected existing customer, saving creates one deterministic relationship bridge and property assignment without duplicating the source customer's identity, property, work, equipment, or financial history.
- [x] Given later edits to the source customer, the linked contact's displayed and future-recipient name and communication channels resolve from the current source profile.
- [x] Given no matching customer, the operator can explicitly choose `Create new contact` and use the existing manual flow.
- [x] Missing, inactive, self-referential, ambiguous, unauthorized, wrong-property, and stale linked-contact identity writes are rejected without partial writes.
- [x] Replaying the same link reuses the deterministic contact and assignment while preserving creation evidence.
- [x] Historical appointment recipient snapshots are not rewritten.

## Plan and risk

- Implementation outline: Add accessible client-side typeahead; submit `link.linkedCustomerId`; write a deterministic relationship-local bridge; hydrate directory and recipient reads from `clients/{linkedCustomerId}`.
- Migration/rollback or recovery: No migration and no production-record rewrite. Existing manual contacts remain compatible. If a post-release defect appears after links have been created, prefer a forward fix so stored relationships remain readable.
- Key risks and mitigations: Prevent self-links and ambiguous identity sources server-side; exclude inactive source profiles; require an active bridge before notifications; keep manual contact creation explicit because shared phone/email values are not sufficient evidence for an automatic merge.

## Verification

- Automated gates: ERP Next typecheck, CRM production guard/acceptance, contact-directory tests, Office Booking Authority suites, live-scheduling regression, Firebase syntax validation, production build, and remote CI.
- Manual scenarios: Authenticated production flow will be checked after deployment; the local environment has no DEMAC production login session.
- Evidence/results: Recorded in `docs/ai/reviews/crm-existing-customer-contact-link-20260829.md`.
- Not run and why: No data migration or destructive production operation exists for this task.
