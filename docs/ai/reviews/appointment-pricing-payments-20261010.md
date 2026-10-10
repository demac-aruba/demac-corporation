# Review: Appointment estimates, final charges and receipts

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer: financial_review. Implementation author: root.
Scope: full product diff and ordinary/hold/emergency/overtime, partial completion,
reschedule/move, commercial guards, pricing, permissions and transport recovery.
Rule: OPS-SCHED-CHARGES-001. Baseline: 1f1bf7783a9bf6706b8008ce0a3fa63a5c065741.

## Findings and corrections

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Canonical accounting role was omitted | Align explicit provisioned role alias; negative/positive tests |
| High | Final-only legacy correction allowed no reason | Require reason for any prior financial amount |
| High | Blank catalog data became zero | Reject absent/blank/non-numeric types; explicit zero preserved |
| High | Field billing evidence could conflict | Canonical candidate validation, AWG-only, explicit fingerprint-bound reconciliation |
| High | Advance could survive customer/Project changes | Reset draft by customer/property/Project/phase/source identity |
| High | Old backend could omit financial data from success | Require financial acknowledgment before UI success |
| Medium | Catalog change between preview/save | Compare quote fingerprint in transaction |
| Medium | Financial version conflict recovery | Explicit reload and tariff refresh; preserve stable uncertain retry |

## Verification

Reviewer independently executed 29 pricing/financial tests and syntax/diff checks; all passed.
Builder evidence includes Booking 235, Field 425 and transactional WhatsApp 121 existing tests,
focused/transitive suite 158 before final small corrections, production build and isolated
real-component financial flows at 1440/1366/390 pixels. Final exact-tree CI, actual-parent browser scenarios (14, including customer/Project/source resets and quote-in-flight) pass.
Real Firestore and final exact-tree CI remain required before release.

Security/data: active profile checked at transaction time; absent, inactive and technician
roles denied; auditor read-only; no direct Firestore write permission added. Read-only
opening does not backfill. Work Orders, Field, payroll, capacity, references and messages
are not written by financial mutations. Legacy evidence blocks competing balances.

Concurrency/recovery: MVCC synthetic contention, expected revisions, stable exact replay,
changed-payload rejection, response-loss browser retry and atomic booking/deposit failure.
Real emulator evidence is required in CI; local Java 17 cannot run Firebase's Java 21 emulator.

## Decision

- [ ] Pass (pending final CI/release identity)
- [ ] Pass with recorded follow-up
- [x] Block until remaining release gates pass

Residual limitations: historical invoices/Legacy money/foreign receipts require reconciliation;
recorded receipts are not bank-verified or QBO-posted. No live customer writes are used as tests.
Owner authorized merge/deploy in this conversation; no additional business approval is pending.
