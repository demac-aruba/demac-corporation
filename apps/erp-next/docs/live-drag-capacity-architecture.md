# LIVE Scheduling Drag Capacity Architecture

## Purpose

Keep manual drag-and-drop movement in LIVE Scheduling aligned with the same canonical operating calendar used by the rendered schedule and Booking Authority. This document records ownership boundaries; it does not introduce a second scheduling rule set.

## Canonical ownership

- `getRuntimeSchedulingSettings().serviceStartTimes` owns the normal Monday-Saturday service-start grid.
- `businessSettings/business-calendar` and `calendarClosures` own company-level closures.
- `vanHalfDaySchedules` owns recurring per-van half-day exceptions.
- Van active/maintenance/out-of-service state and dated `dailyVanAssignments` own fleet availability.
- Booking Authority remains the commit-time authority and revalidates capacity before changing canonical Work Orders.

## LIVE Scheduling responsibilities

The rendered grid and manual move candidate generator must both begin from the same normal service-start grid, then apply `liveOperationalStartTimes` and `liveOperationalWindowAllows` for van-specific exceptions.

No weekday-specific start-time list belongs inside LIVE drag candidate generation. In particular, Saturday must not have an independent 09:00-13:00 drag schedule: Saturday is a normal operating day unless the company calendar or that van's half-day rule says otherwise.

## Regression boundary

`live-drag-saturday-acceptance.ts` verifies that every Saturday drag candidate maps to a start time that the LIVE grid can render, preserves normal morning and afternoon capacity, and rejects the removed legacy 09:00/10:00/11:00/12:00 Saturday-only start set.
