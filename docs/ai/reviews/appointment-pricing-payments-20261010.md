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
| High | Untouched bookings inherited stricter finance permissions | Financial payload is opt-in; old scheduling callers remain unchanged |
| High | Project Authority could retain old commercial guard | Deploy reviewed Project guard first; baseline/configuration checks and final-only/void-history regressions |
| High | Deployment could replace an unreviewed transitive dependency | Independently compare complete deployed/baseline/candidate runtime graphs and manifests; fail before mutation on drift |
| Medium | Catalog change between preview/save | Compare quote fingerprint in transaction |
| Medium | Financial version conflict recovery | Explicit reload and tariff refresh; preserve stable uncertain retry |

## Verification

Reviewer independently executed pricing/financial, booking and historical suites (76 tests in the expanded run), then final financial/Project/deployment regressions (54 tests) and final deployment regressions (5 tests); all passed. These overlapping runs are not additive. Final independent product and release-code review: PASS, with no unresolved material finding. Runtime dependency comparison was independently verified: baseline 151 modules/manifests, candidate 152, exactly seven expected product differences.
Builder evidence includes Booking 235, Field 425 and transactional WhatsApp 121 existing tests,
focused/transitive suite 158 before final small corrections, production build and isolated
real-component financial flows at 1440/1366/390 pixels. Actual-parent browser scenarios (14, including customer/Project/source resets and quote-in-flight) pass.
Real Firestore passed in CI; final exact-tree CI remains required before release.

Security/data: active profile checked at transaction time; absent, inactive and technician
roles denied; auditor read-only; no direct Firestore write permission added. Read-only
opening does not backfill. Work Orders, Field, payroll, capacity, references and messages
are not written by financial mutations. Legacy evidence blocks competing balances.

Concurrency/recovery: MVCC synthetic contention, expected revisions, stable exact replay,
changed-payload rejection, response-loss browser retry and atomic booking/deposit failure.
Actual Firestore emulator: 5/5 PASS in Office Booking workflow run 38087200202
on first published head 2f599ba; local Java 17 cannot run Firebase's Java 21 emulator.
Final release head must repeat the complete required CI; earlier success does not waive it.
Final local financial/booking/pricing/Project suite: 99/99 PASS; deployment regressions: 5/5 PASS.

## Decision

- [x] Pass (independent product and release-code review)
- [ ] Pass with recorded follow-up
- [ ] Block until remaining release gates pass

Release conditions remain mandatory: CI on the exact final head (including real Firestore and browsers), deployed-source preflight, Project then Office deployment with runtime/auth verification, and frontend publication of the tested tree. This review does not claim those production steps have already passed.

Residual limitations: historical invoices/Legacy money/foreign receipts require reconciliation;
recorded receipts are not bank-verified or QBO-posted. No live customer writes are used as tests.
Owner authorized merge/deploy in this conversation; no additional business approval is pending.
