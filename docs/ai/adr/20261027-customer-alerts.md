# Customer-owned internal incidents

Approved scope: the owner requested alert creation in CRM and existing appointments, matching during office booking, and a new-occupant exception that preserves the original incident.

Office Booking Authority owns `customerAlerts/{id}` and private child `events` and `exceptions`. Only freshly provisioned active admin/office/supervisor users can invoke these actions. Existing Firestore default-deny prevents direct browser reads/writes; no Rules, auth configuration or public projection changes are required. No existing entity is rewritten and there is no migration.

The immutable incident captures a canonical customer ID, comment, category, author, time and optional phone/address evidence. Direct customer identity remains a match after moving. Exact normalized phone/address evidence is advisory; independent dwellings include their unit code, and an unselected unit does not match a whole building. Changing status requires a reason and optimistic version; events retain the original text. Financial debt is an operator comment, not a balance or accounting calculation.

An exception belongs to the candidate customer and the exact observed identifiers, for one alert version. It never changes the original customer, suppresses that customer's direct warning, or suppresses a third customer. Reactivation requires review again. Duplicate customer records must be resolved through existing CRM processes; the operator cannot use this exception to dismiss a direct identity match.

The current office booking drawer checks again before confirming/holding. Operators explicitly continue, decline without creating a booking, or confirm another person's identity with a reason. API errors block the current UI confirmation until rechecked; they never imply a clean history. This is an advisory office flow, not an automatic service denial or a new universal Booking Authority prohibition. Other booking channels retain their existing behavior.

Mutations use canonical server reads, transaction-scoped actor authorization, version checks and request receipts. Exact retries recover lost responses without duplicates. UI responses are scoped to the selected identity. Only the new module and facade routing are overlaid into the audited live source package, retaining current fleet changes, dependencies, entrypoints, configuration and IAM. Backend release precedes frontend production publication. Recovery restores prior source/UI; incident records remain intact.
