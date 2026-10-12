# Review: Appointment product/service catalog search

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review
- Reviewer: `/root/financial_review`; implementation author: `/root`.
- Scope: `feature/appointment-catalog-search` production diff based on main `1e9b4568a461367ee4aa8cff25ef34ebc73f19c9`; picker, LinesEditor consumers, capture-phase Escape handling, read contract and backend projection.
- Authorities: services catalog, servicePricingAuthority and Office Booking Authority. Rule OPS-SCHED-CHARGES-001.

## Findings and resolution

| Severity | Location | Evidence and impact | Resolution |
| --- | --- | --- | --- |
| Medium | Picker read failure/loading | Disabled manual fallback could trap a historical retired ID when catalog is unavailable. | Explicit manual/work tariff fallback stays enabled unless the whole editor is locked. Regression passes. |
| Medium | Picker catalog freshness | Newly created items in a separate catalog tab required leaving the draft. | Added explicit read-only refresh retaining all draft fields. Regression passes. |
| Test fixture | New refresh regression | Shared mutable fixture array did not simulate a deserialized network response and caused stale memoized search results. | Stub returns structuredClone, retaining all assertions; production logic unchanged. |
| Medium | Closed picker search indexing | At the supported limits, 60 closed pickers eagerly normalized the same 1,000-item metadata list. | Build the memoized search index only while a picker is open. Full loading suite and typecheck pass; independent targeted rerun passes. |

## Independent verification

- Backend + pricing 31/31 PASS; denied technician read, authorized auditor read, metadata allowlist/bounds, inactive exclusions, zero database writes on list/quote and canonical product pricing.
- Drawer/loading/finance/catalog 30/30 PASS, including both corrections, read failures, version changes, exact retry, session isolation and responsive visuals.
- Real facade financial flow 3/3 PASS at 1440/1366/390: preserved booked work and split BTU, same-ID price/reason retention, fractional product quantity, final confirmation and receipts.
- Typecheck and diff check PASS. Independent desktop/mobile screenshot inspection passed.
- Evidence local directories: reviewer-catalog-final and reviewer-catalog-financial; reproducible committed test scripts retain durable assertions.
- Offline HTML demonstration is separately checked by the Builder and is outside the independent production-code approval.
- Authorized-release follow-up: full drawer/loading suite now 31/31 PASS and typecheck PASS after lazy indexing. The new default regression exercises 1,000 maximum-length catalog entries, 60 charge concepts, at most 40 rendered matches and zero additional authority/network requests or writes while typing.
- Synthetic Chromium development/StrictMode measurements: independent opening sequence 1,359.4 ms before versus 359.5 ms after lazy indexing; after-change input-to-two-animation-frames median 42.8 ms, p95 88.4 ms (15 samples). Builder rerun: opening 350.4 ms, median 45.4 ms, p95 83.3 ms. These include local browser/test conditions; two runs are not a statistical production benchmark. Worst-case uncompressed metadata fixture is 1,176,919 bytes; production catalog size/network latency was not measured.

## Implementation decision

- [x] Pass
- [ ] Pass with recorded follow-up
- [ ] Block / changes required

No unresolved implementation finding in this scope. Approval covers implementation and synthetic verification only. Residual limits: no production authenticated workflow exercised; no owner catalog values supplied; existing 1,000-record list bound unchanged.

## Existing catalog CRUD limitations

Source inspection found two inherited limitations in the unchanged `service-catalog.ts` / `service-catalog-workspace.tsx`: empty/missing price inputs can be normalized to zero (including editing an old item), and the catalog uniqueness check followed by a separate write has no transaction/version precondition. Concurrent editors can overwrite changes or race on booking-code uniqueness. The old native selector already consumed these same canonical records; the new search algorithm does not introduce these behaviors. This review does not approve mass catalog entry, migration, or a claim that concurrent catalog editing is safe. Remediation needs a scoped catalog-write review and isolated concurrency/empty-price tests; it is not silently folded into this read/selection release.

## Release decision after owner authorization

- The owner explicitly authorized merge/deployment after a successful audit on 2026-10-12; authorization is not the remaining blocker.
- **BLOCKED:** the shared live Office backend source has no dependency lock, and its immutable image is missing. Independent inspection of the fresh read-only [runtime audit](https://github.com/demac-aruba/demac-corporation/actions/runs/38303702626/job/114992866197) and artifact confirms revision `officebookingauthority-00082-dov`, failure at `audit-officeBookingAuthority-read-immutable-image`, category `not-found`, no retained build output image/artifact reference. Exact live dependencies and reproducible backend rebuild/rollback remain unverified.
- This evidence comes from another change auditing the same live backend, not from a CI run of the catalog candidate. No code from that change is included here.
- Main and frontend production were identified; frontend rollback candidate is `dpl_56YCZgumwiVymoskkt79Shb13ycW`. Backend recovery verification is still critical, so neither main merge nor a partial frontend deployment is approved by this review.
- See the task document for evidence distinctions, remaining recovery prerequisite and release sequence. No real client/cita/payment writes, test communications, migration, runtime configuration change or deployment were performed.
