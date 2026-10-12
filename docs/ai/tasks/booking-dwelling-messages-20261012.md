# Task: Preserve the selected apartment in booking communications

## Current follow-up status — 2026-10-12
- Application code is deployed; final production audit remains open. PR574 is unmerged.
- Configuration-only recovery run 38313992739 completed the API operation, but maxInstanceCount still read 20. It failed verification and must not be rerun with stale revision/source leases.
- A missing pre-update Function API field does not by itself prove different effective scaling. Extend read-only inspection to old/current Cloud Run revision scaling annotations, current service/template scaling and traffic. Do not change capacity based on the absent field alone.
- Recheck Cloud Logging through a timestamp-only query and the caller's project testIamPermissions. This reads permissions and grants none. Permission denial remains a blocked audit, not evidence of zero errors.
- Main has advanced since the previous release; any later publication needs a fresh integration and source/configuration check. This diagnostic branch does not deploy.

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
- Preserve live dependency locks except the explicitly approved Office reconstruction below; preserve unrelated source, runtime/secret bindings, IAM and both schedule definitions. Verify source after deployment.
- Before any write, audit all five live candidates and run isolated tests on each actual source plus patch. Stop on unknown source, drift, failed gates or boundaries.
- Record each prior revision and versioned source archive. Recovery redeploys the saved prior source for the affected function using the same source-only command; never restores/deletes a database or edits queue/history. Mixed old/new format during rollout is compatible.
- Already queued/sent messages remain unchanged. This release affects newly prepared eligible messages.

## Verification
- Syntax validation, 239 Booking tests, 133 communication tests and 14 release/configuration safety tests for the final source.
- Full isolated property/dwelling editor, concurrency, canonical booking persistence, saved-location message preparation and deny-role tests.
- Current-main CI includes payment compatibility and browser checks; no failing gate may be waived.
- Live pre/post checks are configuration/source inspection, scheduler inspection and actual-domain OPTIONS/anonymous-denial probes, never a real booking or WhatsApp send.

## Approved reconstruction — 2026-10-12 continuation
The owner explicitly approved preparing an isolated reproducible rebuild after exact-lock recovery failed. This authorizes a reviewed dependency-baseline change, not a claim that lost dependency versions were recovered. Original failed evidence remains recorded in PR570 (runs 38299836829, 38303702626, 38304100608).

- Limit missing-lock reconstruction to officeBookingAuthority revision officebookingauthority-00082-dov with the reviewed original dependency declarations. Other functions keep their own deployed package/lock.
- Commit the new complete npm lock; use npm ci; keep firebase-admin/functions on their existing major lines. npm audit found high advisories in old sharp/nodemailer: use sharp 0.35.5 and nodemailer 10.0.16 for reconstruction. Sharp's Node >=20.9 requirement is compatible with production Node22; the code uses ordinary RGB/RGBA JPEG/PNG operations, not removed sharp APIs.
- Remaining audit entries derive from uuid's v3/v5/v6 caller-supplied-buffer advisory. Inspected google-gax, gaxios and teeny-request consumers use v4() without a supplied buffer. Do not introduce an unrelated Firebase major upgrade solely to suppress the report. Record residual advisory evidence explicitly.
- Install from each candidate's exact lock, never the runner's unrelated node_modules. Test deployed-original source and patched source separately, with credentials removed, demo project/loopback endpoints and a test-process network guard. For reconstructed Office, require original booking/communication/Office regression suites and persisted-booking Firestore scenarios for both versions.
- Smoke-load each actual bootstrap under Node22 and verify its deployed export (all five across their respective archives), declared native image/mail dependencies, and Office HTTP CORS/anonymous denial. No transport delivery.
- Reverse the bounded patch and prove its file manifest equals the tested baseline. Archive baseline and candidate packages before any production deployment; retain those known-repository source/public-lock artifacts in GitHub for 90 days. No cloud configuration, credentials, customer records or queue exports enter artifacts.
- Re-run preparation on the release branch; require successful artifact upload and matching baseline/candidate/configuration/source hashes for ALL five targets before the first write. Check both runtime and build configuration, IAM, schedules and source identity.
- Reversion uses the tested baseline package and the same bounded source-only command. For Office it restores prior application behavior with the reviewed new dependency baseline; it cannot restore unknown/deleted dependency versions. Operational data is never restored, deleted or rewritten by rollback.
- Future Office deployments must include the committed lock; transactional/Office/Van validation uses npm ci. Existing [merge-only] barriers and all tests remain enforced.

## Completed prepublication evidence
Read-only run 38307339610 passed the five original/candidate runtime audits, source recovery equality, deterministic archive extraction and production configuration/scheduler/domain checks. Recovery packages were uploaded as artifact 11773306089 before any deployment. The final legacy-address compatibility regression and integrated CI must pass on the exact merge head; release preparation repeats the five audits and uploads a fresh recovery artifact before publication. See the review record and subsequent PR570 status for final commit/run/deployment evidence.
