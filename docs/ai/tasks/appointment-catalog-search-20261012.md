# Task: Find products and services when preparing appointment charges

## Context

- Owner requested catalog products/services so office operators can search and select them when preparing the customer's charge.
- Existing `/catalog/` CRUD already owns products and detailed services in `services`, including title, description, base price, SKU/category and service duration. Appointment editor offered only a native name dropdown.
- Deep Review: catalog selection feeds operational financial drafts. No actual catalog/prices were supplied for entry.

## Scope

- Search active catalog by name, description, category and SKU; filter services/products; display duration and descriptive metadata using the existing blue/purple visual language.
- Autofill an explicitly selected final/additional concept's label; preserve booked work identity/label/quantity and split BTU; preserve manual price/reason when choosing the same ID again.
- Explicitly refresh after creating an item in the existing catalog, retaining the draft; allow manual/work tariff fallback even if the catalog read fails.
- Expand only the existing authorized read projection with bounded commercial metadata. Quote, mutation, payment, version and receipt authorities remain unchanged.
- Excludes catalog seeding, migrations, stock, invoice issuance/QBO and pricing rule changes. The owner subsequently authorized merge and deployment, conditional on a successful technical and functional audit.

## Governance

- Authorities: `services` for commercial identity; `servicePricingAuthority` for pricing; Office Booking Authority / `appointments.jobCharges` for operational snapshots and payments. Rule OPS-SCHED-CHARGES-001.
- Read metadata allowlist has no price/cost, stock or arbitrary document spread. Backend actor authorization and existing UI `canManage`/pending-operation locks remain.
- Old ID/name-only responses stay compatible; inactive/historical selected IDs and agreed amounts remain until explicit replacement. Search/filter/refresh do not write or reprice.
- No new source of truth, ADR, legacy migration or security-rule change. Existing detailed service duration stays separate from quick booking work types.

## Acceptance criteria

- [x] Name/description/SKU search, diacritics and multiple tokens; product/service filters; distinct loading, empty, failure and no-match states.
- [x] Selection uses canonical ID, preserves same-ID agreements, and preserves booked work/split BTU. Fractional product quantities still quote through the server.
- [x] Refresh surfaces newly created items without losing price/reason; failed list reads still permit explicit manual fallback.
- [x] Escape closes a focused picker without closing the drawer; active financial writes keep the original keyboard lock.
- [x] Desktop/mobile visual checks; no document overflow; existing receipts, exact retries, permissions and stale-version handling pass.

## Plan and risk

- Reuse existing catalog CRUD and financial editor. Search a single bounded list locally; render at most 40 matches. Explicit refresh uses read-only transport.
- Index metadata only when an individual picker opens, avoiding repeated preparation across up to 60 closed pickers.
- No backfill or migration. Rollback is a scoped code revert; extra optional metadata is backward compatible.
- The existing backend fails closed if the bounded query finds more than 1,000 total catalog documents (including inactive entries), then otherwise projects active items. This change does not introduce catalog pagination.
- Backend metadata must be deployed with the next approved release for full descriptions/filters; old deployed responses retain name search only.

## Verification

- Builder and independent reviewer: backend/pricing 31 tests; drawer/loading/financial 30 cases; real facade booking-to-final and four-method split payments at 1440/1366/390, including split-BTU preserveWork, same-ID preservation and fractional product addition.
- Builder: 17 appointment detail parity/keyboard scenarios, typecheck, Functions syntax validation and production frontend build (including required prebuild suites).
- Offline HTML create-product, create-service (90-minute duration), select-product and calculated total passed at 1440/390; actual screens visually inspected.
- Synthetic transports/databases only. No real customer data or production records changed.
- Release-audit performance correction: full loading suite 31/31 and typecheck passed. With 1,000 maximum-length items and 60 concepts, the independent synthetic opening sequence dropped from 1,359.4 ms to 359.5 ms; local search rendered at most 40 matches and made no additional authority/network calls or writes. These are local Chromium development measurements, not production latency claims. Worst-case metadata fixture: 1,176,919 bytes uncompressed.
- Reproducible offline HTML preview uses actual catalog CRUD, domain helpers and booking editor with in-memory data, explicit fictitious-data banner and CSP connect-src none. This is review evidence, not a deployable substitute for server financial authority.
- No production authenticated end-to-end check has been performed. Real catalog entry still requires owner-supplied catalog values.

## Authorized release audit and blocker

- Owner authorization received on 2026-10-12; no additional general merge/deploy approval is needed. Publication must stop if a critical verification remains unresolved.
- Repository: `demac-aruba/demac-corporation`; target `main` remained `1e9b4568a461367ee4aa8cff25ef34ebc73f19c9` during this audit. Product candidate `c63bf7d2` retains the approved screenshots' actual components.
- Production domain: `https://demac-aruba.com`; Vercel project `demac-corporation-web`, deployment `dpl_56YCZgumwiVymoskkt79Shb13ycW`, source `e304c05e51322bfc21e20aa85aefa5e7325d43cf` (same source tree as target main). This is the frontend rollback candidate, not a database restore.
- Fresh non-destructive production checks during this release audit: scheduling route HTTP 200, Office OPTIONS from the real domain HTTP 204 with accepted CORS, anonymous `list_charge_services` HTTP 401. These verify reachability/access boundaries only; they do not prove authenticated financial functionality or production performance.
- Full catalog metadata needs a new `officeBookingAuthority` backend deployment in Firebase project `demac-corporation`, `us-central1`. The generic workflow redeploys the full Functions source; compatibility with the exact live dependencies is a required release gate.
- A fresh read-only runtime audit for another change affecting this same backend, [run 38303702626 / job 114992866197](https://github.com/demac-aruba/demac-corporation/actions/runs/38303702626/job/114992866197), failed before any deployment. This task independently inspected its workflow/script, log and `summary.json` artifact. It is live-backend evidence, not a test of this catalog candidate.
- Verified blocker: serving revision `officebookingauthority-00082-dov` has no dependency lock in its source archive. Recovery from its immutable image failed because that image manifest is missing. The associated successful build has no retained output images/artifact reference in the inspected metadata. A registry cleanup policy deletes images older than one day; it may explain the missing image, but causality is not established.
- Consequently the exact deployed dependency set and a reproducible backend rebuild/rollback cannot be verified. Do not substitute a newly resolved lock, waive this gate, deploy floating dependencies, or publish a frontend-only partial release.
- Required recovery: retrieve a lock or dependency artifact with verifiable provenance to the serving revision, or separately define and validate a controlled dependency baseline/recovery plan. Then audit the actual backend source/configuration, rerun affected CI against current main, and deploy/verify the complete reviewed version. No production data rollback or migration is needed for this feature.
- Release status: **BLOCKED before merge and deploy**. No production records, communications, configuration or deployments were changed by this task.
