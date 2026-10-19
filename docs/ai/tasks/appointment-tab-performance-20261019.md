# Task: retain an appointment's financial session across its detail tabs

## Context and scope

Owner requests fast switching between Resumen, Importes y pagos and Historial.
Deep Review: this optimization touches financial editing-session lifetime, not amounts,
permissions, prices, persistence or the backend. Production baseline is
`271d0c035e43d001dc32269800a8542a6f8334dd` (payment and message editor enabled).

Observed cause: workspace remains mounted, but every tab exit disables the edit hook,
releasing its lease. Returning acquires a new session, advances the server financial
version, rereads the record and requotes the unchanged draft. History also unmounts
the financial content/catalog search. Existing fixture omitted the lease version advance.

## Governance and design

- Office Booking Authority remains the only writer; OPS-SCHED-CHARGES-001/002 apply.
- First visit to Importes y pagos starts the session; summary/history-only access and
  read-only users never acquire. Keep that session for this open appointment dialog.
- Closing/changing appointment or principal, revoked permissions and server blockers
  release ownership. Existing renewal, expiry, token/version guards and retries remain.
- Keep financial content mounted while hidden in History, preserving catalog and inputs.
- Freshness reads after 30 seconds, explicit refresh, post-write reads and fresh PDF
  verification remain. No persistent/global financial cache or backend/schema change.

## Acceptance and verification

- [x] Measure before/after tab cycles with delayed synthetic reads and genuine lease fencing.
- [x] No new acquisitions, charge reads, quotes or catalog reads on settled rapid tab cycles.
- [x] Amount/description/payment drafts and review state survive; no false pending balance.
- [x] Closing, identity/appointment changes, revoked permission, late responses and lease
  loss/expiry preserve isolation and prevent stale writes; history-only never acquires.
- [x] Existing drawer, real-authority finance, recovery/balance and type/build gates pass.
- [ ] Independent review and exact release/production verification before activation.

## Risk and recovery

An operator who has entered finance reserves this appointment while its dialog remains
open on any internal tab. Other operators can read; closing or server expiry permits
handoff. This is intentional to remove tab-induced fencing. No data migration. Rollback
is frontend-only to the previously active deployment, preserving all generated receipts.

## Measured evidence

- Baseline: 4 return transitions on each of 1440px / 390px, with synthetic read
  delay 1000ms, acquisition 200ms and quote 600ms. Each return took 2069–2110ms;
  each viewport added 4 record reads, 4 acquisitions, 4 quotes and 4 catalog reads,
  with 4 temporary pending-total transitions.
- Corrected focused run: 76–105ms, zero additional calls/version advances and no
  pending-total transitions. These are controlled browser measurements, not claims
  about production network latency.
- Real Office authority over isolated transactional database: 7 end-to-end flows
  pass, including the 375 work / 250 payment / 125 balance case, save/reopen/PDF,
  foreign-version conflict and exact uncertain-operation retry.
- 13 balance/PDF, 8 recovery and 7 backend editing-coordination assertions pass.
- Independent review added a freshness finding for History → Finance after 30s;
  passing the visible view to the existing freshness effect resolves it while
  preserving single-flight reads and draft suspension.

Final local verification: 80 drawer scenarios, 7 real-authority financial flows,
16 independent review probes and production Next build pass. Build initially rejected
out-of-root dependency symlinks; using local dependency directories fixed that
environment issue. No build configuration or production dependencies were changed.
Exact-head CI, reviewed deployment and domain checks remain release gates.
