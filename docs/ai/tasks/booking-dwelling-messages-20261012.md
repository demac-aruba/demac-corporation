# Task: Preserve the selected apartment in booking communications

## Context
- Owner Christian reported that confirmations, reminders and morning technician messages omit the booked apartment.
- Owner authorized merge/deploy only after a technical and functional audit on 2026-10-12.
- Mode: Deep Review; separate Solo Maintainer Adversarial Review after the original implementation.
- Repo: demac-aruba/demac-corporation; PR570; production ERP: https://demac-aruba.com; Firebase project demac-corporation / us-central1.

## Scope and governance
- Existing Booking Authority validates Customer → Property → Dwelling and freezes locationSnapshot in Appointment and Work Orders.
- Reuse the existing communication authority and queue. No new sender, recipients, business rules, model, migration, data backfill, resends or scheduler changes.
- CRM-LOCATION-001, OPS-SCHED-REFERENCES-001 and COMMS existing recipient/idempotency boundaries apply.
- Confidential access/contact/instruction fields stay outside customer message address parameters.
- Legacy records without saved dwelling context keep their original property/address. Current master data must not retroactively classify them.
- ERP Next UI and Legacy application code are unchanged. The payment overview from main PR571 must remain integrated.
- Architecture decision: no new authority; existing dwelling ADR and communication boundaries remain applicable.

## Acceptance criteria
- Creation, saved snapshot, customer confirmation/reminder and technician message preparation retain the selected unit.
- Saved name/code survive later master-data renaming; related support uses only its linked Appointment.
- Cross-property, neighboring-unit and unrelated-appointment context cannot substitute a location.
- Existing selected recipients, languages, queue IDs, retry, disabled notifications, backdating, temporary holds, attachments and financial workflows remain intact.
- No production test writes or messages. All functional tests use in-memory stores or loopback demo Firestore.

## Publication and recovery
- Generic WhatsApp deployment also runs unrelated queue/group migrations: DO NOT use it for this release.
- Merge with [merge-only], then create the dedicated release/booking-dwelling-messages-20261012 branch at the exact reviewed PR head already contained in main.
- Dedicated release authenticates with the existing scoped GitHub service account. Patch the actual deployed source for five existing functions only: officeBookingAuthority, queueAppointmentConfirmation, sendDailyAppointmentReminders, sendDailyTechnicianSchedules and notifyBookingReferenceUpdate.
- Preserve live dependency locks, unrelated source, runtime/secret bindings, IAM and both schedule definitions. Verify source after deployment.
- Before any write, audit all five live candidates and run isolated tests on each actual source plus patch. Stop on unknown source, drift, failed gates or boundaries.
- Record each prior revision and versioned source archive. Recovery redeploys the saved prior source for the affected function using the same source-only command; never restores/deletes a database or edits queue/history. Mixed old/new format during rollout is compatible.
- Already queued/sent messages remain unchanged. This release affects newly prepared eligible messages.

## Verification
- Syntax validation, 239 Booking tests, 132 communication tests and 8 release/configuration safety tests.
- Full isolated property/dwelling editor, concurrency, canonical booking persistence, saved-location message preparation and deny-role tests.
- Current-main CI includes payment compatibility and browser checks; no failing gate may be waived.
- Live pre/post checks are configuration/source inspection, scheduler inspection and actual-domain OPTIONS/anonymous-denial probes, never a real booking or WhatsApp send.
