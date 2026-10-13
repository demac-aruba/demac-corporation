# Review: Catalog article lines

## Review mode and scope
- Independent Review: /root/projection_review; implementation: /root.
- Branch fix/catalog-charge-lines, based on main14eda789.
- Scope: task ../tasks/catalog-charge-lines-20261013.md; OPS-SCHED-CHARGES-001/002.
- Financial selection/quotation and old snapshots; catalog UI, leases, versions, payment drafts,
  quote tokens, exact retries and current Pricing Authority consumers.

## Findings and resolution
| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Removing BTU inputs alone leaves a valid 12k_standard_service article unpriced | Appointment quote resolves capacity from its canonical booking code; real governed fixtures replace misleading fixed-only examples |
| Medium | Current catalog definitions could reinterpret old agreements | Exact historical snapshot is retained before capacity derivation; inactive/changed catalog and historical null-BTU prices tested |
| Medium | An old client can echo a forecast minimum as a final price | Existing projectionOnly protection preserved; 18K forecast125 becomes final145 while original remains125 |
| Low | Pending article message blamed catalog configuration exclusively | Message allows selecting the specific article and retains fail-closed final confirmation |

Reviewer found no further blocking code issues after the capacity correction. Independent and Builder runs:53/53 PASS, zero skipped. An initial environment-only
missing dependency was resolved by using the existing test dependency path; the full suite was rerun.

## Verification
- Real financial browser flow at1440/1366/390: catalog-code BTU resolution, sequential add/remove,
  fixed-price add-ons/products, fractional quantity, receipt/void with draft retention, exact
  response-loss retry and persisted totals after reload PASS.
- 38 browser loading/catalog/concurrency cases PASS. One mounted search, no new catalog fetch
  per line, no authority/network requests while typing, 40-result bound and60-line bound verified.
- Standalone local search benchmark:1000 synthetic articles, median60.2ms/p95 98.4ms, zero requests while typing. Concurrent runs are retained separately; no production latency claim.
- Typecheck and production build PASS. Build-generated tsconfig/next-env changes restored.
- React review: no conditional hooks; semantic input/button labels; Escape stays inside search;
  focus returns to the next search; existing disabled/version/lease guards remain active.
- New real Firestore test exercises quote/final persistence, canonical BTU and exact retry with
  no invoice/payment side effects. Local Java17 cannot start required emulator; CI Java21 gate pending.
- No production reads/writes, migrations, credentials changes or customer communications.

## Decision and remaining gate
Code review: accepted; independent GO for PR/preview. Completion requires the applicable CI/Firestore gate to pass on the final
head. UI screenshots contain only synthetic records. The main QBO changes remain included.
No deployment authorization is inferred for this new correction; it is prepared for product review.
On activation deploy compatible backend first, retain projectionOnly, and never restore old data.
