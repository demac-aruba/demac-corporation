# Technician Portal mandatory scenario evidence

Status date: 2026-08-28
Branch: `feature/technician-portal-canonical-foundation`

This register maps each of the 26 mandatory scenarios to executable evidence. Tests are evidence for the canonical deliverables; they are not counted as additional features. The exact booked-1/actual-3 fixture is part of the domain acceptance gate and does not rewrite Appointment history.

## Automated result

- `npm run test:field-domain --prefix apps/erp-next`: **PASS**
- `npm run test:field-offline --prefix apps/erp-next`: **PASS**
- `node --test functions/fieldOperationsSaleLines.test.js`: **PASS (10/10)**
- Functions Field Authority core, in-process equivalent of the CI file manifest: **PASS (347/347)**
- Functions Booking Authority, in-process equivalent of the CI file manifest: **PASS (95/95)**
- Functions Field extension gate: **PASS (47/47)**
- ERP Next typecheck and Field security contracts: **PASS**
- Firebase static validation: **PASS**

## Scenario-to-evidence matrix

| # | Mandatory behavior | Executable evidence | Result |
|---:|---|---|---|
| 1 | Planned 1 / actual 1 | `apps/erp-next/scripts/field-operations-acceptance.ts`, Scenario 1 | PASS |
| 2 | Planned 1 / actual 2 assets | Domain acceptance Scenario 2; `fieldOperationsVisitAssets.test.js` — planned one may attach two actual assets | PASS |
| 3 | Two interventions on one asset | Domain acceptance Scenario 3 | PASS |
| 4 | Planned 2 / actual 1 plus not-performed disposition | Domain acceptance Scenario 4; `fieldOperationsPlannedWorkDispositions.test.js` — planned two actual one reconciles without rewriting plan | PASS |
| 5 | Unknown BTU does not block booking | Domain acceptance Scenario 5; booking snapshot remains independent from field technical data | PASS |
| 6 | Register A/C on site | Domain acceptance Scenario 6; `fieldOperationsEquipmentRegistration.test.js` — required technical identity and photos, QR optional | PASS |
| 7 | Known QR attaches the correct asset | `fieldOperationsVisitAssets.test.js` — QR identification attaches only matching canonical A/C with `qr_scan` provenance | PASS |
| 8 | Foreign-customer QR is denied | `fieldOperationsVisitAssets.test.js` — QR cannot attach/reassign an A/C from another Customer or Property | PASS |
| 9 | Catalog Switch is searchable/governed | `fieldOperationsSaleLines.test.js` — Switch, Armaflex and arbitrary active Products remain governed options | PASS |
| 10 | Catalog Armaflex is searchable/governed | Same catalog-product acceptance test | PASS |
| 11 | Arbitrary active catalog material is searchable/governed | Same catalog-product acceptance test | PASS |
| 12 | Non-catalog material requires Office Review and creates no shadow catalog | `fieldOperationsSaleLines.test.js` — non-catalog draft remains unpriced and Office-review-required | PASS |
| 13 | Declined add-on is retained and not billed | Domain acceptance Scenario 13; Sale Lines declined transition test; Billing Candidates declined/voided exclusion test | PASS |
| 14 | Partial completion remains truthful | Domain acceptance Scenario 14; `fieldOperationsProfessionalReport.test.js` — pending-part projects partial, not final | PASS |
| 15 | Second visit preserves the first visit | Domain acceptance Scenario 15; `fieldOperationsReturnVisits.test.js` — distinct physical WorkVisit preserves prior visit and scope | PASS |
| 16 | Concurrent lead/helper report editing is safe | Checklist and Free Text response tests — helper edit plus canonical response version/audit behavior | PASS |
| 17 | Helper billable-work attempt is denied server-side | Scope Change and Sale Line authority tests — helper/read-only authority fails closed | PASS |
| 18 | Unassigned-team known-ID access is denied | `fieldOperationsAuthorityWorkVisit.test.js` — unassigned technician cannot prepare another team's visit; VisitAsset authority denial | PASS |
| 19 | Offline interruption causes no permanent data loss | `apps/erp-next/scripts/field-offline-contract-acceptance.ts` — user-scoped cache/draft/outbox and exact replay | PASS |
| 20 | Two-device updates do not destructively overwrite | Checklist and Free Text response tests — stale expected version fails closed; offline contract preserves blocked copy | PASS |
| 21 | Returned report preserves prior submission and reviewer note | `fieldOperationsOfficeReview.test.js` — corrected resubmission freezes both correction contexts in revision 2 | PASS |
| 22 | Approved revision is locked | `fieldOperationsOfficeReview.test.js` — approval completes visit, locks review and exact retry is idempotent | PASS |
| 23 | Individual interventions appear in Customer history | `fieldOperationsHistories.test.js` — Customer projection includes individual interventions across Work Orders | PASS |
| 24 | Interventions attach to exact Equipment history | `fieldOperationsHistories.test.js` — Equipment projection references only exact canonical asset records | PASS |
| 25 | Billing candidate uses approved actual lines | Domain acceptance Scenario 25; Billing Candidate test — priced actual work projects candidate without invoices | PASS |
| 26 | Booked quantity remains immutable historical intent | Domain acceptance Scenario 26 and exact fixture: booked 1 Standard Service; actual Sala Standard Service, Bedroom Standard Service + Switch, Kitchen Check-up; Appointment remains 1 | PASS |

## Interpretation

The mandatory scenario deliverable is **PASS** at branch level. Firestore/Storage target-policy evidence also passes separately in `TECHNICIAN_PORTAL_RULES_EVIDENCE.md`; the current-main Solo Maintainer review and exact-candidate remote CI are PASS. This evidence does not authorize deployment and does not replace the human UAT/merge boundaries.
