# ERP Next — Reversible Demo Data Mode V1

## Objective

Populate the live ERP with a realistic but completely fictitious operating day so DEMAC can evaluate visual density, navigation, exception handling and cross-module behavior before activating real production persistence.

## Dataset

Dataset ID: `full-day-2026-08-11-v1`

Operational date: **2026-08-11**

The initial dataset contains:

- 24 fictitious CRM customers
- 24 fictitious properties/sites
- 24 registered fictitious HVAC assets
- 24 confirmed appointments
- 24 Work Orders
- 6 appointments per van across VAN-1 through VAN-4
- exact HVAC asset scope for every Work Order
- verified demo workforce for all four vans
- verified demo tool custody/policies
- material readiness plans
- site-access plans, including controlled AT RISK/BLOCKED examples
- commercial policy evidence
- submitted, in-field and not-started field-work examples
- Office Review records with approved/pending/returned examples
- customer report-delivery examples
- dispatch physical-movement history
- afternoon Ready-to-Depart examples
- one released AT RISK example
- billing candidates, preview receivables and fictitious payment/allocation examples

## Visual operating scenario

Morning work intentionally contains a mixture of:

- submitted jobs
- in-field jobs
- one BLOCKED late job
- one AT RISK late job

Afternoon work intentionally contains:

- full van schedules
- Ready-to-Depart assignments
- Not Ready assignments
- one AT RISK assignment with an Operations release

This is intended to exercise:

- Daily Dispatch Control
- Dispatch Readiness Board
- Live Dispatch Board
- Operations Exception Queue
- Delay Propagation
- Daily Close
- Customer 360 timeline
- Office Review
- Field execution
- Command Center
- billing/payment projections

## Reversible overlay architecture

Demo Data Mode does **not** permanently delete or mutate the user's previous browser-preview dataset.

Before installation, ERP Next records the raw current value of every browser storage key that the demo dataset will replace.

Install flow:

existing browser-preview state
→ exact raw backup
→ demo dataset overlay
→ live visual testing

Clear flow:

demo dataset
→ restore exact raw backup
→ demo preference disabled
→ normal preview state resumes

The backup includes dynamic per-customer CRM master keys created by the demo dataset.

## Controls

A global banner appears inside ERP Next while Demo Data Mode is available.

When active:

- **Reset Demo Day** restores the original pre-demo backup and recreates the pristine Aug 11 dataset.
- **Clear Demo Data** restores the exact pre-demo browser state and disables automatic demo loading.

When disabled:

- **Load Full Aug 11 Demo** can re-enable the reversible dataset.

## Important limitation

This V1 dataset is stored in the ERP Next **browser-preview persistence layer**, not Firestore/Firebase production storage.

Consequences:

- it is local to the browser/device
- it is safe for visual testing
- it cannot affect Aruba Bank, QuickBooks, WhatsApp or production customers
- another browser/device will receive its own demo overlay when it opens the updated ERP
- clearing browser site data can remove the preview/demo state

When DEMAC activates Firebase production persistence, a future shared sandbox/demo tenant can use the same concept with explicit `demo` tenant isolation rather than browser storage.

## Guardrails

- Every fixture ID uses the `DEMO-` namespace.
- Contact details are deliberately fictitious.
- No real customer, payment, bank, QBO or communication provider record is created.
- No external message is sent.
- No production API is called.
- Demo financial records are preview projections only.
- Clearing the demo restores the pre-demo state rather than blindly deleting all ERP preview data.
