# LIVE Drag & Drop Root Cause — 2026-08-22

## Symptom

On Saturday 2026-08-29, double-clicking an appointment correctly armed move mode and the header reported valid targets, but no visible open slot became a usable drop target.

## Root cause

A stale Saturday-only schedule remained in `lib/live-scheduling-move.ts`:

- move candidates used `09:00, 10:00, 11:00, 12:00`
- the rendered LIVE schedule had already been corrected to the normal Monday-Saturday grid (`08:30, 09:30, 10:30, 13:30, 14:30, 15:30`)

The candidate counter therefore showed candidates that had no matching rendered target key. The drag event system itself was still armed; the candidate/display key spaces no longer intersected.

## Correction

Remove the Saturday-only start list from LIVE drag candidate generation. Both rendering and manual drag now begin from `getRuntimeSchedulingSettings().serviceStartTimes`, then apply canonical company closures, van half-days, and van availability.

No new business rule or schedule store was added.
