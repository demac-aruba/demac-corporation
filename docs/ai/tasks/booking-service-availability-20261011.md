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
- No migrations, customer/appointment writes, test messages, financial changes or new workflows.
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
