# Complete imported scheduling-reference review and Inventory evidence

## Request / scope
Christian authorized continuing PR #514 safely toward release readiness, not production
activation or a premature merge. Deep Review; exact inspected source fd69123.

This increment closes two code gaps: no owner-governed exit from pending import reference
review, and no canonical Inventory issue visibility in central Projects. It does not invent
QBO expenses, valuation, person-time, restore evidence, or completed physical scope.

## Authority and implementation
- Existing Projects registry owns reviewed migration metadata, receipt and audit. Existing
  Owner authorization, optimistic version, source digest and transaction are retained.
- Preview verifies immutable original source identities, all referenced appointments, and
  all primary/support Work Orders. Known missing/foreign references block finalization.
  A source row without any identifier can only be retained as explicitly unverified with
  an individual Owner explanation. It cannot be counted as executed work.
- Finalization changes only migration metadata to history_reviewed, with source-version
  proofs in the existing Project event. Budget, lifecycle, archive and operations stay intact.
  Current links/source references are the review scope; it is not proof all operator browser
  profiles have been captured. That limitation requires explicit acknowledgement.
- Inventory movements are read for a selected server-validated Project Work Order, 40 per
  page. No stock writes, Field fan-out, polling or guessed historical costs. Cancellation
  of a Work Order never deletes or automatically reverses an issue.

## Acceptance / failure behavior
Current roles, stable request replay during write pause, version/source conflicts, no partial
migration metadata on audit failure, source preservation, support inclusion, access denial,
strict unknown records, pagination and browser/mobile stale-response safety must be tested.
No test or required check may be disabled to get a pass. No live/customer data in fixtures.

## Release gates still external or separate
QuickBooks remains the approved accounting authority; actual posting/valuation input is not
implemented by pretending catalog prices are historic expenses. Field Van intervals are not
per-person project allocations. Original browser backups, Cloud backup completion and isolated
restore rehearsal, reviewed staging/index configuration, and actual historical reconciliation
are separate unperformed gates. Source code or a green emulator cannot certify them.
