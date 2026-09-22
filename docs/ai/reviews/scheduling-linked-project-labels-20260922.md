# Existing Project labels — adversarial self-review

Mode: Solo Maintainer Adversarial Review; same maintainer, separate pass after
implementation. This is not an independent review.

## Findings and evidence

- No write path changed. The pure join requires exact Project assignment projectId,
  appointmentId and a current canonical workOrderId, plus Customer/Property equality.
  Names, Other, duration, date, free-text notes and Project search order are not evidence.
- Ambiguous Project claims and duplicate Project IDs cannot select an arbitrary name.
  Invalid nested assignments/phases are tolerated. Missing phase evidence omits the
  phase name. React text rendering escapes labels.
- Project metadata is capability-gated, never copied into the operational appointment,
  never retained by attribution caching, and cleared by session remount. Read state is
  refreshed on storage/focus and the existing refresh path; removal does not retain a
  stale Project label. Callback dependencies remain stable across metadata changes.
- Calendar slot ownership, technical/capacity times, move keys, cancellation, creation,
  dispatch, lifecycle writers and Booked-by geometry are unchanged. Project labels
  suppress inappropriate service-unit estimates without rewriting their source fields.
- Normal, conflict and details presentation receive the same context. Project names
  do not propagate to unrelated appointments for the same Customer/Property.
- Existing browser Project storage remains noncanonical and origin-local. No claim
  of cross-session backend verification or completion of historical Projects is made.

## Gates

PASS: ERP typecheck; Scheduling acceptance (including new exact-link negative cases);
Dispatch acceptance; lifecycle acceptance; full ERP build and all normal prebuild gates,
with explicit synthetic Firebase configuration and telemetry disabled.

PASS: Chromium component simulation at 1440×1000 and 390×844, each observed for 90 real
seconds (901 samples, 11 reads, 4 attribution loads). Card geometry and Booked-by stayed
stable; Project rename/removal, missing permission, stale week/cancellation/session
responses and unmount passed. Zero page errors or external requests. Screenshots
visually inspected; Project/name/phase and each Van's six reserved slots are readable.
This is synthetic component evidence, not authenticated production verification.

Release/integration evidence is recorded in the publication report. No real production records are test fixtures,
and no backend, security rule or production data changes are part of this release.

## Decision

The scoped read-only label correction is suitable for the owner's authorized release
when browser regression and integration gates pass. It is not approval or evidence for
the still-incomplete original historical/cross-browser Projects work.
