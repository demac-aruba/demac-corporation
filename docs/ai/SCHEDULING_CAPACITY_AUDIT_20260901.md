# Scheduling Capacity Authority audit — 2026-09-01

## Executive result

The Sep 1 / Van 4 / 08:30 / `Other` 180-minute incident is not a
180-minute capacity-calculation failure. The request was made at approximately
09:05 Aruba time for an 08:30 start on the same date. The LIVE board continued
to present that elapsed start as `OPEN` and actionable, while Booking Authority
correctly removed it before candidate-capacity evaluation. The provider then
replaced the precise temporal cause with the aggregate
`required-primary-target-unavailable` reason.

The recurring defect class is projection/authority drift:

1. the board independently projected a start slot without a reactive current-time
   guard;
2. the drawer described the clicked one-hour tile as an `OPEN BLOCK`, even after
   the workload changed to three hours;
3. the authority returned no structured elimination reason to the operator; and
4. Van identity, Work Order status, crew, and partial-read semantics were
   interpreted differently in several projections.

## Exact incident reconstruction

Observed local request time: `2026-09-01 09:05` America/Aruba (UTC-4).

The browser request shape is:

```js
{
  action: "check_availability",
  data: {
    requestId: "schedule-create-check-<nonce>",
    customerId: "<selected canonical customer>",
    propertyId: "<selected canonical property>",
    workLines: [{
      id: "<draft line>",
      presetId: "other",
      serviceId: "<canonical Other service>",
      quantity: 1,
      manualDurationMinutes: 180
    }],
    requestedDate: "2026-09-01",
    requestedTime: "08:30",
    requiredVanId: "VAN-4"
  }
}
```

The selected production customer/property IDs were not recoverable from the
available unauthenticated Preview/production session. They are not involved in
the elimination after canonical property validation and are intentionally not
included in diagnostics.

Canonical workload resolution was reproduced as:

| Field | Value |
| --- | --- |
| duration mode | `manual` |
| quantity | `1` |
| total duration | `180 minutes` |
| required capacity slots | `3` |
| attempted work interval | `08:30–11:30` |
| intended owned starts | `08:30`, `09:30`, `10:30` |
| required primary Van | `VAN-4` |
| exact target required | `true` |

With a valid active Van/crew and no Work Orders, the same fixture at 07:00
returns a valid exact option for 08:30–11:30. At 09:05, the engine discards
08:30 at the same-day start-time guard before assignment combinations or
candidate availability. Therefore no Work Order, half-day, route, crew, or
duration rule was needed to produce this incident.

## Current call graph

```text
LIVE schedule tile (read projection; one start)
  -> LiveAppointmentCreateDrawer
     -> checkOfficeBookingAvailability
        -> officeBookingAuthority HTTP function
           -> officeBookingAuthorityFacade / canonical wrapper
              -> bookingAuthorityFirestore.checkAvailability
                 -> bookingAuthoritySchedulingProvider
                    -> load date-scoped canonical data
                    -> canonicalizeSchedulingData
                    -> bookingAuthoritySchedulingEngine
                       -> resolveWorkScope
                       -> build allocation plan
                       -> iterate date / Van / start
                       -> same-day future-start guard  <-- incident eliminated
                       -> resolve crew assignment
                       -> candidateAvailability
                          -> operating/half-day interval
                          -> Work Order conflicts
                          -> route policy
                    -> aggregate provider result
                 -> versioned offer / structured denial
     -> commitOfficeBookingOffer
        -> transactionally reload/revalidate
        -> Appointment + Work Order(s) + capacity locks
```

The clicked tile's visual `end` (`09:30`) is not sent as booking capacity and
does not overwrite the resolved 180-minute workload. It was a misleading label,
not the backend rejection cause.

## Authority classification

### 1. Authority

- `functions/officeBookingAuthority.js` and its facade/wrapper boundary
- `functions/bookingAuthorityFirestore.js`
- `functions/bookingAuthoritySchedulingProvider.js`
- `functions/bookingAuthoritySchedulingEngine.js`
- transactional lifecycle/move/support/remaining-work authority modules

Only these layers may approve or mutate bookability. Final commits reload and
revalidate canonical state transactionally and use idempotent request/offer
identities.

### 2. Domain primitives

- canonical workload and allocation policy in the scheduling engine
- interval, slot, overlap, route, calendar and crew primitives in
  `bookingCapacityAvailability.js` and `bookingSchedulingPrimitives.js`
- canonical Van identity/alias resolution in `bookingVanIdentity.js`

### 3. Read projections

- `apps/erp-next/lib/live-scheduling.ts`
- `apps/erp-next/lib/live-operational-capacity.ts`
- `apps/erp-next/lib/scheduling-capacity.ts`
- visual schedule day cache/policy/model
- Remaining Work timeline and operational move shortlist

These may display known occupancy and known-invalid starts. They may not approve
a mutation or contradict an authority result.

### 4. UI-only orchestration

- create/edit/reschedule drawers and panels
- input signatures, debounce, request sequencing, labels and formatting
- board interactions and responsive presentation

## Drift and obsolete logic found

| Area | Duplicate or divergent behavior | Risk / disposition |
| --- | --- | --- |
| current time | LIVE rendered all configured starts and froze `today` at mount; authority rejects same-day starts at or before current time | Production defect; use a reactive injected clock for the projection |
| allocation display | drawer retained clicked one-hour tile end while authority evaluated complete workload | Misleading UX; render selected start separately from authority allocation |
| diagnostics | candidate failures became `null`, then a generic required-target reason | Preserve a bounded structured rejection contract |
| Work Order status | authority used case-sensitive Spanish spellings; LIVE normalized only cancellation; move used a third set | Consolidate normalized blocking semantics; unknown values fail closed |
| unlinked Work Orders | normal authority may block without `appointmentId`; LIVE and move may omit them | Hidden blocker risk; denial must identify the integrity blocker. Visual treatment is `NEEDS_HUMAN` if product wants repair controls |
| crew/absence | authority resolves driver, active staff and absence; LIVE operational projection did not load absences and could call unassigned crew active | OPEN/REJECT drift; board must not claim verified bookability from partial operational context |
| partial cache failure | one read path converted Work Order load failure to an empty successful list | False OPEN risk; degraded/unknown data must fail closed |
| drag/move | client shortlist duplicated duration/window/overlap and used `previewVans` | Authority remains final; shortlist must use canonical dynamic fleet and shared projection primitives |
| operational move commit | production `MOVE_APPOINTMENT` used a separate evaluator, omitted canonical half-day/closure/absence state, and ignored unlinked active Work Orders | Production safety defect; move must use the same fail-closed candidate contract and transactional snapshot as normal booking |
| final commit revalidation | full provider revalidation occurred immediately before, but outside, the Firestore transaction; the transaction reread only a subset of gating state | Race defect; the complete canonical snapshot and a fresh Aruba clock must be reread/re-evaluated inside every transaction attempt |
| Remaining Work | authority options were re-filtered with local operational policy and numeric Van regex | Can hide valid options/future Vans; authority result wins, local state is explanatory only |
| Remaining Work / reschedule grid | the general customer shortlist returned two options, while the visual date grid treated every omitted Van as a rejected complete match | False rejection; date-grid mode must return one complete representative allocation per eligible primary Van/start rather than reuse the two-option client shortlist |
| legacy booking code | dormant `scheduling.ts`, `scheduling-capacity.ts`, Booking Copilot helpers contain another solver; legacy manual duration/fingerprint are incomplete | Quarantine as non-authoritative or replace consumers with authority adapters |
| Van identity | backend/frontend inferred identity from editable display names and accepted only numeric `VAN-N` identities in several active paths | Collision/rename/future-fleet defect; canonical master-data IDs are stable and opaque, while historical aliases must be explicit |
| fixed fleets | dispatch/readiness/manual send/calendar contain four-Van arrays | Architectural debt; dynamic registry required before those surfaces can claim future-fleet parity |
| half-day window | backend reduced a configurable half-day record to a boolean and hardcoded the capacity end | Policy drift; candidate math must consume the record's canonical `workdayStart`/`workdayEnd`/extra start values |

## Static Van assumption classification

- **A — fixture/history:** seed/demo data, explicit historical migrations, and the
  four original WhatsApp group mappings. These may name specific Vans when the
  scope is explicitly historical or test data.
- **B — architectural debt:** dormant preview solvers and display formatting that
  reconstruct names using `VAN-N` string operations.
- **C — production risk:** numeric-only canonicalization, active operational
  projection filters, capacity-profile whitelist, Remaining Work numeric filter,
  fixed move targets, and any active board/dispatch surface with a fixed lane list.

No per-Van branch was found inside the core capacity algorithm. The engine is
already generic once a Van reaches it; the defect is identity/projection input
loss before and around the engine.

## Race and stale-offer findings

- Create and edit availability checks already use a request signature and epoch;
  a late 60-minute result cannot replace a current 180-minute result.
- Superseded network requests were not aborted, so unnecessary server work could
  continue.
- Offer expiry was not retained/displayed in create state.
- Request-affecting controls were not frozen during hold/commit. The backend
  remains transactionally safe, but the visible draft could change while a
  previously captured offer was committing.
- Rapid Hold/Confirm clicks needed a synchronous in-flight guard in addition to
  React disabled state.

## Target architecture

```text
canonical Van registry + calendar + crew + Work Orders
                          |
UI CapacityRequest -------+
                          v
                  Booking Authority
              resolve canonical workload
              evaluate complete allocation
             /                            \
 structured AllocationOption       structured AllocationRejection
             \                            /
              operator-safe read projection
                          |
                 transactional revalidation
                          |
       canonical Appointment + Work Orders + locks
```

The response additions are backward-compatible. Existing `reason` values remain
available while `metadata.diagnostic` and resolved workload/allocation fields
explain the exact result without customer/contact/address data.

## Preserved business rules / human decisions

- Approved lunch, half-day, route, service-capacity and crew rules are unchanged.
- Whether an unlinked canonical Work Order should be automatically repaired or
  only surfaced as a data-integrity blocker is **NEEDS_HUMAN**. Until decided,
  mutation safety must fail closed and diagnostics must make the blocker visible.
- No rule permitting overlaps or travel exceptions was introduced.

## Required proof before merge

1. **Incident proof:** before 08:30, Other/180 resolves to 08:30–11:30; after
   08:30 the board is non-actionable and authority reports a temporal rejection.
2. **Existing fleet proof:** parameterized canonical snapshots give each active
   configured Van the same identity-invariant answer.
3. **Future fleet proof:** `VAN-FUTURE-TEST-947` enters through canonical data,
   accepts 08:30/180, rejects it with a 09:30 blocker, and accepts it after the
   blocker is cancelled—without adding its ID to production code.

## Implemented result and four-pass outcome

- **Pass 1 — architecture:** Booking Authority is the sole mutation-grade capacity evaluator; all 65 App Router entries are guarded from the quarantined browser/Copilot solvers. Dynamic, opaque Van identity is carried through registry, authority, board, move and picker paths.
- **Pass 2 — domain and transactions:** create, hold, reschedule, move, support, after-hours and remaining-work flows use live transactional revalidation, payload-bound idempotency and owner-checked lock release/reclamation. Terminal Work Orders fail closed.
- **Pass 3 — async/performance:** stale availability is abortable/sequence-safe, commits are single-flight, after-write refreshes cannot be swallowed, one identity-safe capacity read feeds each projection, attribution is deduplicated, and absences are week-scoped.
- **Pass 4 — UX/accessibility:** the operator sees the resolved complete allocation and bounded rejection reason; expired/missing-expiry offers fail closed; past starts are not actionable; responsive one-column reschedule and accessible dialog/status semantics are present.

No P0/P1 finding remains in the completed review. Legacy simulator modules remain quarantined and are prevented from becoming production dependencies by CI. Production was not mutated and `main` was not merged.

## Final verification evidence

- Firebase syntax validation: PASS.
- Booking Authority: 226/226 PASS.
- Transactional communications: 115/115 PASS.
- Customer Agent: 78/78 PASS; public router 1/1 PASS.
- ERP typecheck and acceptance gates: LIVE scheduling, capacity parity, dispatch, lifecycle, Booking Intelligence, Booking Copilot, production boundary and Van profile all PASS.
- Production Webpack build: PASS, 54 routes generated; employee schedule/attendance prebuild gates PASS.
