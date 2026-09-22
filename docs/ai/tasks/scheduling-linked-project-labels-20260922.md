# Existing Project links in Scheduling

## Scope and acceptance

Owner reports that an existing Project booking still reads Other. Display Project,
the existing Project name and linked phase names when the current browser's existing
assignment joins the live appointment and work order by exact IDs, with matching
canonical Customer and Property. No name/date/duration inference and no real customer
data in fixtures. Ordinary and mixed-service bookings retain their existing semantics.

The owner subsequently authorized conflict resolution, merge and production deployment.
This authorizes a bounded frontend correction; it does not make the original three-part
historical Projects request complete.

## Review mode and boundaries

Deep Review, Solo Maintainer Review Mode, due to the session/permission and refresh
behavior surrounding the presentation. Authority matrix: Booking Authority continues
to own appointments, Work Orders and reserved capacity. Existing browser Projects
remain preview data. This change only reads their existing IDs and labels; it creates
no source of record, new persistence, backend request, migration or business write.
No new architectural decision is introduced.

Project labels require the existing projects.view capability and a live scheduling
session. Missing/corrupt/ambiguous links fall back to the existing service summary.
Metadata reloads on focus, storage events, successful-create refresh and regular
Scheduling refresh. Remounting the session clears prior presentation state.

## Verification and release plan

Run typecheck, Scheduling/Dispatch/lifecycle regressions, full ERP build with normal
prebuild gates, and desktop/mobile component simulations with synthetic reads and no
external network. Exercise exact/mismatched/ambiguous IDs, malformed state, edits,
removal, permission loss, automatic refresh, attribution delay/failure and stale reads.

Release from current production 8a852d81 plus this correction to avoid unintentionally
shipping the pending main overtime/backend pairing. Integrate current main separately,
preserving its overtime behavior and merge-only deployment guards. Stage the ERP
Vercel production artifact without domains, verify assets/revision, then promote the
same artifact. Roll back to dpl_9L3HKUX8HvZxhBMfPvaY4amH1U5A if needed.

## Explicit remaining limitations

Release sequencing update: PR #518 merged while this task was validating. The final
frontend candidate therefore includes its bounded release source 2e9c6981 plus the
unchanged Project-label patch 600a79fa. Do not promote it until the Property backend
and frontend publication completes. This preserves the new Property editor and keeps
pending overtime excluded. The final deployment IDs and verification are in the
owner-facing publication record.

The link is available only on the origin/browser where Projects saved it. This does
not add canonical Project persistence, historical Project booking, historical crew
resolution, or cross-browser identity. The supplied Projects screenshot proves the
visible Project record exists; it does not reveal the linked appointment/Work Order
IDs. Authenticated inspection of that live record was unavailable due to browser
automation startup failure. Synthetic tests must not be reported as live-data tests.
