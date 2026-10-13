# ADR: Catalog selections own actual-work specifications

- Status: Accepted (owner's product clarification); production activation pending
- Date: 2026-10-13
- Rules: OPS-SCHED-CHARGES-001/002
- Clarifies actual-work entry in automatic-booking-projection-20261013; booking forecasts unchanged.

## Decision
The appointment editor adds existing catalog articles as separate immutable selections.
Quantity and removal are available; service kind, price and BTU are not editable controls.
One catalog search remains mounted below the selected list, with an explicit + Añadir action.

Final quotation preserves an exact historical snapshot before consulting current catalog data.
For a new/recalculated article whose canonical booking code explicitly identifies capacity,
Appointment Charges supplies that capacity to the existing Pricing Authority and saves it on
the quote/final line. An explicit contradictory capacity fails closed. Names and SKUs never
define capacity. Fixed-price articles continue to use canonical basePrice without BTU input.
Generic tiered/matrix articles still require a specific configured article; no minimum becomes
a final charge. Booking projection behavior and all shared Pricing Authority consumers stay unchanged.

## Alternatives and consequences
A frontend-only removal of inputs is insufficient: valid 12k_standard_service catalog articles
still require capacity in the pricing contract. Changing shared Pricing Authority would unnecessarily
affect Field and other consumers. The narrow Appointment Charges adapter resolves this boundary.
No schema migration or new source of truth is introduced. Legacy prices/labels/identity survive.
Only one catalog read is needed for the editor; search remains local and bounded to 40 results.

## Verification and activation
Test governed and fixed articles, pending pricing, historical agreement retention, exact replay,
minimum-vs-final isolation, sequential additions, payment concurrency and responsive rendering.
Publish a compatible backend before the new frontend; preserve the projectionOnly guard on recovery.
Do not run customer-record mutations or communications as deployment tests.
