# ADR-20261027: Canonical fleet activation controls scheduling lanes

- Status: Accepted business intent; implementation pending release
- Date: 2026-10-27
- Owner: DEMAC Operations / Booking Authority
- Rule: OPS-VAN-FLEET-001
- Related task: ../tasks/dynamic-fleet-activation-20261027.md

## Context and precedence
The 2026-08-28 dynamic-Vans work enabled backend catalog discovery, but the earlier advanced-profile four-Van client guard survived. The owner's 2026-10-27 request explicitly removes that guard. This decision supersedes only the future-Van activation/WhatsApp restriction in `reviews/advanced-vans-profile-20260828.md`; crew, identity, permission and retry controls remain.

## Decision
Use the canonical fleet catalog for identity and configured status for operational eligibility; no per-number deployment is needed. New empty profiles still start out of service. An active authorized driver can activate a sole-person team using existing `Trabajo liviano`; `Disponible` retains its helper requirement at storage. No staff assignment is invented. Booking Authority revalidates every selected Van's existence and status in the booking transaction, even for older crew records.

The schedule shows operational lanes for the selected date. Bookings attached to a now-unavailable Van stay accessible in a separate attention list without open slots. Weekly metrics evaluate the entire known fleet for each date. A profile-only save never changes the partial-day rule. Existing domain authorities, source IDs and historical records are retained.

## Consequences and recovery
New Vans require explicit setup/activation, suitable crew, schedule and their own WhatsApp recipient configuration. No group is copied or guessed. This does not automatically activate VAN-5 or send messages. The previous profile guard can be restored by rolling back the frontend; keep the commit-time backend guard as a safe forward fix. Existing bookings on added lanes must remain accessible during recovery. Backend-first publication and the correct ERP domain are required; no production data migration or security-rule change.
