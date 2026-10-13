# Review: QuickBooks sales/payment design and read evidence

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer / agent: Codex root, separate pass after writing the design.
Implementation author / agent: Codex root.
This is a review of a design, not an independent review or a runtime release approval.

## Scope reviewed

- Request: continue the agreed sales/payment planning while completing read validation.
- Diff: four documentation files against `f4369f3a4e4835f17cb8a387596494f427af53f0`.
- Boundaries checked: appointmentCharges, current report service/formatter/HTTP handler,
  Authority Matrix, Business Rules, Quality Gates and current release evidence.
- Existing sources retained: CRM, Pricing, Booking/Field, Inventory and QBO accounting.
- No runtime caller, cloud configuration, permission, credential or financial record changes.

## Findings

| Severity | Location | Evidence and impact | Required correction / disposition |
| --- | --- | --- | --- |
| High design risk | Source change during provider POST | A last preflight version check cannot prevent an edit after the POST starts. | Design now explicitly retains the original-version result and blocks payments/new sends for reconciliation; no false claim of cross-system atomicity. Must test S08/S18 in implementation. |
| High design risk | Retry after uncertain POST | A new operation identity can create a duplicate invoice even if amounts match. | Persistent business-document identity, frozen payload, uncertainty state and explicit provider reconciliation specified. Provider deduplication semantics remain an implementation gate, not assumed verified. |
| High design risk | Inventory item in service pilot | An inventory sale can change QBO stock/cost before the physical-inventory integration exists. | Initial pilot excludes inventory items; S20 explicitly tests denial. Existing ERP stock functionality is not removed or changed. |
| High design risk | Historical/direct-QBO records | Lack of a local mapping does not prove a transaction is absent in QBO. | Cutoff, existing-link checks, reviewed mapping and conflict handling required; S09/S16. |
| Medium design risk | Taxes, settlement accounts, fractional quantity | Guessing configuration or substituting net bank settlement can misstate amounts. | Real mappings and fiscal examples required before posting; S19/S21; no tax percentage or account ID invented. |
| Medium | Balance Sheet diagnosis | All formatter failures currently expose one generic code. No actual rejected field/payload has been captured. | Root cause remains open. Design specifies safe enumerated diagnostics and verified update procedure; no speculative validator relaxation or claim of fix. |
| Medium | Release evidence | First authenticated P&L comparison was still described as pending. | Updated to the comparison already performed in the owner-authorized session; aging comparison/Balance Sheet/live token renewal remain pending. No private report amounts committed. |

## Verification

- Gate scope: documentation path/link validation, consistency review and whitespace/diff check.
- Runtime syntax/build/tests: N/A, no executable files changed.
- Authorization/negative-path/retry cases: specified in S01-S21; NOT EXECUTED by this change.
- Real accounting writes: none. No Sandbox write evidence claimed.
- Review checks distinguish operational receipts from QBO posting, QBO balances from
  operational estimates, read verification from books accuracy, and proposal from activation.
- Live limitation: retained browser observations were blocked by environment credential
  protection. This does not establish an Intuit outage or invalidate the prior P&L comparison.
- Automated documentation checks: PASS — four documentation files, nine local links
  resolved, S01-S21 complete and unique, zero runtime files, `git diff --cached --check`
  clean. The final evidence wording was rechecked after this update.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up (design only)
- [ ] Block / changes required

Residual work belongs to the ERP integration maintainer: resolve Balance Sheet, extend
the reviewed read surface for mappings, build the preparation workflow and execute S01-S21
in Sandbox. No deadline invented. Owner/accounting decisions are limited to concrete
mapping/tax/cutoff choices after the actual configuration can be presented.

Human approval boundary: this proposal does not authorize production accounting writes,
new scopes, new access or a competing source of truth. The prior read-only release remains
unchanged. A successful document review cannot be used as evidence to activate synchronization.
