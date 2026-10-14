# ADR: bounded catalog reads and provisional comparison

Date: 2026-10-14. Status: implemented candidate; production activation pending.

The owner intends to reuse existing QuickBooks customers and articles instead of
duplicating them. Before any persistent mappings or accounting writes, expose a
designated-owner catalog comparison at the existing authenticated connection page.

Add POST `/catalog` to the dedicated read-only reports function. It accepts only
`entity` (Customer, Item, Account) and aligned `startPosition` (1..99901), generates a
fixed GET query for the pinned DEMAC realm, includes inactive records and returns at
most 100 normalized identity/configuration records. No arbitrary query, host, tenant,
amounts, balances, addresses or full provider payload reaches the browser. Provider
payloads are bounded to 2 MiB. No returned catalog records enter logs/audit or storage.

Use the existing reports/OAuth operation lease, refresh uncertainty marker, encrypted
credential rotation and owner checks before acquisition, provider call and delivery.
Refactoring stays inside the current service to avoid two divergent token owners.
Existing report requests and response contracts remain compatible. Catalog access
additionally requires `QBO_PRODUCTION_CATALOG_ENABLED=true`; absent/false is disabled.
The existing first-install release guard remains intact. This change does not update
the live backend, activate that flag, or relax CORS/rules/owner permissions.

Read ERP customers and services through existing authorized APIs only after the QBO
read succeeds. Exact normalized names/email/SKU generate provisional review candidates,
including inactive and incompatible-type candidates for visibility; they never approve
identity. Names, SKU, tax, currency, customer hierarchy, type and accounts still require
review and fresh validation before a future persistent mapping. No new source of truth.

Pages are independent observations, not a transactional catalog snapshot. Full pages
always offer another read or an explicit upper-bound warning. A lack of a candidate
is labeled only as no match in the current page. This screen cannot prove an entity
is missing and cannot create one. ERP display is capped at 100 filtered rows with an
explicit total and search, avoiding unbounded DOM work. A completed end page does not
prove a stable complete catalog across concurrently changing provider data.

Rollback: remove the additive UI/route or leave the catalog flag off. No mapping,
invoice, payment, stock, CRM or service data migration exists. Only existing private
integration transport metadata/audit and token maintenance can be written by reads.

Intuit references inspected 2026-10-14:
- https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/customer
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/Item
- https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account
- https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/docs/_sources/quickstart.rst.txt

Remaining gates: reviewed existing-function update/source/revision verification,
explicit activation, live catalog response validation, mapping persistence and approval
workflow, accounting setup/cutoff, then Sandbox invoice/partial-payment tests. None is
represented as complete by synthetic catalog tests.
