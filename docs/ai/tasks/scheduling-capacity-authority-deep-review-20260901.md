# Task: Unify Scheduling capacity authority and projections

## Context

- Request/source: Owner master audit dated 2026-09-01, including the global future-Van requirement.
- Product surface and users: Scheduling & Dispatch, Booking Authority, office booking, reschedule, remaining work, operational move, support assignment, and AI booking consumers.
- Current behavior/evidence:
  - At approximately 09:05 Aruba time on 2026-09-01, the LIVE board still rendered Van 4 at 08:30 as open and bookable.
  - `Other`, quantity 1, `manualDurationMinutes: 180` resolves canonically to manual mode, 180 minutes, three capacity slots, and 08:30-11:30.
  - `bookingAuthoritySchedulingEngine.generateCanonicalOptions` rejects the same-day 08:30 start because it is not later than 09:05. This happens before Van, crew, half-day, route, or Work Order conflict evaluation.
  - The provider then collapses that precise condition to `required-primary-target-unavailable`.
  - The engine iterates its Van input generically, but `bookingVanIdentity` and several UI projections discard non-numeric Van IDs. `VAN-FUTURE-TEST-947` is therefore removed before reaching the generic engine.

## Scope

- In scope:
  - A structured capacity request/workload/candidate/rejection contract.
  - Exact internal rejection diagnostics with a safe operator message.
  - Full-allocation data returned by Booking Authority and rendered by New Appointment.
  - Past-start parity between the LIVE board and Booking Authority.
  - Status normalization and board/authority slot-ownership parity.
  - Stale-response/offer invalidation proof.
  - Dynamic, opaque Van IDs in the authority, operational registry, LIVE board, remaining-work picker, and scheduling move inputs.
  - Authority-focused regression matrix, projection parity, and arbitrary future-Van acceptance.
- Out of scope:
  - Changing approved DEMAC lunch, route, crew, half-day, or service-capacity policy.
  - Merging to `main` or deploying production without owner approval.
  - Customer-specific or Van-4-specific exceptions.
- Files/boundaries expected:
  - `functions/booking*`, `functions/officeBookingAuthority*`
  - `apps/erp-next/lib/{live-scheduling,live-operational-capacity,office-booking-authority,scheduling-capacity,van-profile}*`
  - Scheduling drawers, board, visual capacity pickers, acceptance tests, governing docs, and CI.

## Governance

- Authority owner(s): Booking Authority owns bookability and transactional revalidation. Canonical Firestore Work Orders own committed slot occupancy. The LIVE board is a read projection.
- Business-rule IDs: OPS-SVC-001, OPS-TEAM rules, OPS-SCHED-LUNCH-001, business-calendar and Van half-day settings.
- Security/privacy impact: Diagnostics must avoid customer/contact/address data and expose only operator-safe messages plus bounded machine-readable scheduling metadata.
- Legacy parity impact: Preserve current approved scheduling behavior; obsolete four-Van and status-spelling assumptions are removed rather than copied.
- ADR/debt impact: Resolves AD-008 in the active Scheduling path and reduces AD-009 projection drift. See `docs/ai/ADR_SCHEDULING_CAPACITY_AUTHORITY_V1.md`.

## Acceptance criteria

- [x] Given a full-day operational Van with 08:30, 09:30, and 10:30 free, when `Other` is 180 minutes at 08:30 before that start, then Booking Authority returns 08:30-11:30 with three owned slots.
- [x] Given the same start after 08:30 on the same date, the board is not actionable and Booking Authority returns a structured `START_TIME_PASSED` rejection.
- [x] Given any blocking slot or operational policy, the safe response contains a stable rejection code/stage without exposing private customer data.
- [x] Given a workload mutation or rapid requests, an older result cannot become the active offer and final commit still revalidates transactionally/idempotently.
- [x] Given `VAN-FUTURE-TEST-947` with valid active crew, it is accepted by the canonical registry, authority, board projection, and picker without a new code path.
- [x] Given a conflicting 09:30 Work Order for the future Van, 08:30/180 is rejected; after the blocker is cancelled, capacity is restored.
- [x] For the same canonical snapshot, board slot ownership agrees with authority slot ownership.
- [x] Failure/denial behavior: fail closed for missing operational policy; never present a past or canonically blocked target as bookable.
- [x] Audit/observability behavior: every rejected exact target retains code, stage, Van, date, attempted interval, and bounded conflict/policy details.

## Plan and risk

- Implementation outline:
  1. Introduce diagnostic candidate evaluation while retaining a compatibility wrapper.
  2. Carry resolved workload and rejections through engine, provider, Firestore authority, client contract, and drawer.
  3. Correct temporal projection and mark past starts unavailable.
  4. Normalize blocking statuses once in domain primitives and consume that interpretation in projections.
  5. Make Van identity opaque/dynamic end to end.
  6. Add regression/parity/future-Van tests and targeted CI.
- Migration/rollback or recovery: additive API fields and stable existing fields; rollback is the branch/PR. No data migration is required.
- Key risks and mitigations:
  - Diagnostics leaking private data: allow-list diagnostic fields and hash/bound identifiers where needed.
  - Projection accidentally becoming authority: board only disables known-invalid starts and visualizes authority output; commits remain server-revalidated.
  - Dynamic identity splitting legacy physical Vans: prefer explicit numeric business identity/name aliases before opaque record-ID fallback.
  - Rule invention: ambiguous lunch/travel/overlap behavior remains unchanged and is marked `NEEDS_HUMAN` if encountered.

## Verification

- Automated gates: Booking Authority unit suite, new capacity matrix, projection parity, future-Van property cases, ERP typecheck/build, targeted acceptance scripts and CI.
- Manual scenarios: exact Sep 1 reproduction on Preview, dynamic allocation summary, stale-response churn, future-Van board/picker visibility.
- Evidence/results: `validate:firebase` PASS; Booking Authority 226/226; transactional WhatsApp 115/115; Customer Agent 78/78 plus router 1/1; ERP typecheck, LIVE scheduling (five acceptance scripts), capacity parity, dispatch, lifecycle, Booking Intelligence, Booking Copilot/65-route production boundary, Van profile, employee prebuild gates, and Webpack production build (54 routes) PASS.
- Not run and why: production mutation tests are forbidden before explicit owner approval.
