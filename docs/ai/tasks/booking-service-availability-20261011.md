# Task: Restore Booking reference loading

## Context and evidence
- Owner reports both contact directory and scheduling service fetch failures after #566.
- 2026-10-11 00:28 UTC: public Cloud Functions URL and Cloud Run URL return HTTP 503
  to unauthenticated OPTIONS/POST. Browser reports Failed to fetch because the platform
  error lacks application CORS headers. No customer records were read or changed.
- Latest frontend #567 changes appointment finance loading only; Office deployment is
  #566 revision officebookingauthority-00082-dov, previously smoke-tested 204/401.

## Scope and governance
- Deep Review: production runtime incident, with independent review under AGENTS.md.
- Diagnose Office Booking runtime and restore existing service availability; preserve
  existing Firebase authentication, role checks, Booking Authority and all business rules.
- No migrations, customer/appointment writes, test messages, financial changes or new business workflows.
- Authorities: Identity and roles; Scheduling and capacity; canonical Contact/Customer/Property.
- Preserve OPS-SCHED-SPOTS-001 and already deployed nonbillable Field helper guard.
- Deployment authority: owner's explicit audit/merge/deploy approval in this conversation,
  carried forward to correction of the released Booking change.

## Acceptance and verification plan
- Read-only infrastructure evidence identifies the failing boundary before changing it.
- Production actual ERP origins pass CORS; both reference actions reject anonymous tokens
  normally, without platform 503. Authorized behavior checked in isolated tests.
- Applicable Booking/Office regression and startup tests pass; independent reviewer approves.
- Preserve data, endpoint, existing API actions, identity and runtime configuration outside
  the documented correction. Record remaining limits and recovery plan once cause is known.

## Read-only investigation results
- Both the local public probes and GitHub runner reproduced platform errors without CORS:
  initially 503, then 429. Other Project/Field/reference services also returned platform errors.
  This is a shared infrastructure incident, not evidence of an occupied booking slot.
- Cloud Run reports the unchanged Office revision as Ready with 100% traffic. The Functions
  ACTIVE flag alone is insufficient evidence of service availability.
- Runtime logs are denied to the existing deployment service account (`PERMISSION_DENIED`).
  No IAM modification or alternate identity was attempted. This audit remains failed.
- Monitoring reads are permitted. Full current-revision results (no remaining pages) show
  zero active and idle Office instances at 00:26–00:37 UTC; preceding sampled memory
  distribution means peak at approximately 73%, and preceding instance count peaks at two.
  These samples do not prove or exclude OOM; they do not justify increasing memory or max instances.
- Project billing is enabled. No exceeded quota series were returned. An instances quota
  reports zero; its relevance must be established before treating it as the cause.
- Service Usage read in run 38099309862 (source d0097cc) succeeded without IAM changes.
  The generic Instances quota has region-dependent defaults; its us-central1 bucket
  omits numeric limit fields. This does not establish an applicable service-instance cap
  and does not authorize a quota change. The runtime-log blocker remains.
- Independent reviewer checked the diagnostic boundary and separately retrieved final CI
  evidence. Review location: `../reviews/booking-service-availability-20261011.md`.
- Focused local Office authentication/catalog/master-data suites: 47 passed, zero failures
  and zero skipped. No authenticated customer request or booking write was performed in production.
- Evidence: runs 38098705455, 38098942746, 38099051138 and 38099173217 on
  `fix/booking-service-availability`; initial diagnostic source 791aea3 and infrastructure
  quota investigation source c112a8b. These commits are diagnostic-only, not a runtime release.

## Remaining blocker and recovery boundary
- Owner's expanded request log (image 20261011-005247, entry 20:46:34 local / 00:46:34 UTC)
  confirms the platform's exact reason: request aborted because there was no available instance.
  It is a request warning, not the runtime/system error explaining why an instance is unavailable.
  Check the independent service/revision scaling limits through both Cloud Run API versions.
- Need an actual runtime/platform error or authoritative applicable limit to establish the cause.
  The owner can provide the expanded Office runtime error from Google Cloud, or explicitly
  approve the necessary read-only logging permission for the existing deployment identity.
- Do not roll back UI features, widen CORS, raise quotas, modify IAM or redeploy on an unproven
  hypothesis. Once evidence identifies a correction, retain existing auth/domain behavior,
  use the existing reviewed release path, and verify both real ERP origins after release.
- Another incident branch/PR #568 covers appointment finance against the same Office endpoint.
  A single coordinated runtime correction must cover both affected readers; do not create a
  competing backend or duplicate business process.
