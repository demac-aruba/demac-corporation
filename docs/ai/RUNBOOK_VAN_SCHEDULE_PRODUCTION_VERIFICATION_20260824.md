# Runbook: Van Schedule Production Verification

Date: 2026-08-24
Scope: PR #427 / issue #428
Status: pre-merge verification procedure

## Purpose

Verify the repaired Van schedule deployment and Firebase-managed Cloud Scheduler path before PR #427 is merged, without creating a second Scheduler job, manually invoking the schedule, or sending a duplicate test schedule.

## Safety boundaries

- Do not manually run Cloud Scheduler.
- Do not invoke the scheduled Cloud Run/Function endpoint.
- Do not use `sendNow`, one-time senders, probes, or historical correction workflows.
- Do not create a replacement Scheduler job.
- Do not resend a Van schedule merely to prove deployment.
- Use only the existing `Transactional WhatsApp Production` workflow and its canonical Firebase deployment path.

## 1. IAM prerequisite

An authorized Google Cloud principal with permission to modify project IAM must grant the existing GitHub/Firebase deployment service account the Architecture V1 role:

```bash
gcloud projects add-iam-policy-binding demac-corporation \
  --member='serviceAccount:firebase-adminsdk-fbsvc@demac-corporation.iam.gserviceaccount.com' \
  --role='roles/cloudscheduler.admin' \
  --condition=None
```

Do **not** grant `roles/cloudscheduler.serviceAgent` to this deployment principal.

Verify the project policy contains an unconditional binding for:

- member: `serviceAccount:firebase-adminsdk-fbsvc@demac-corporation.iam.gserviceaccount.com`
- role: `roles/cloudscheduler.admin`
- condition: none

Issue #428 remains open until this is verified by the deployment workflow and the controlled deployment succeeds.

## 2. Freeze the PR commit

Before dispatching, read PR #427's current `head_sha`. Use that exact full SHA as the deployment target. Do not deploy if the PR head changes after review/authorization; re-run CI/review against the new head first.

## 3. Controlled pre-merge dispatch

In GitHub Actions, open `Transactional WhatsApp Production`, choose **Run workflow**, and select branch:

`fix/van-schedule-delivery-architecture-20260824`

Provide all guarded inputs:

- `deploy_to_production`: `true`
- `confirmation`: `DEPLOY_TRANSACTIONAL_WHATSAPP`
- `expected_sha`: exact full PR #427 `head_sha`

The deployment job is fail-closed. It runs only if the selected workflow ref's `GITHUB_SHA` exactly matches `expected_sha` and the confirmation string is exact.

Equivalent GitHub CLI shape for an authorized operator:

```bash
gh workflow run .github/workflows/whatsapp-transactional-production-deploy.yml \
  --ref fix/van-schedule-delivery-architecture-20260824 \
  -f deploy_to_production=true \
  -f confirmation=DEPLOY_TRANSACTIONAL_WHATSAPP \
  -f expected_sha='<EXACT_PR_427_HEAD_SHA>'
```

## 4. Required deployment evidence

The workflow must pass all of the following before the deployment itself is considered valid:

1. transactional producer validation/tests;
2. exact project-level unconditional `roles/cloudscheduler.admin` preflight;
3. live Cloud Scheduler list/read probe;
4. Firebase deployment of only the governed notification producers;
5. `queueAppointmentConfirmation` ACTIVE with expected Firestore event trigger;
6. `sendDailyAppointmentReminders` ACTIVE;
7. `sendDailyTechnicianSchedules` ACTIVE;
8. exact job `firebase-schedule-sendDailyTechnicianSchedules-us-central1` exists;
9. job state `ENABLED`;
10. schedule `0,5,10 8 * * *`;
11. timezone `America/Aruba`;
12. HTTP target present;
13. OIDC invoker identity present.

A paused job is a failure requiring investigation; the workflow must not silently resume it.

## 5. Automatic execution proof

Do not manually fire the Scheduler after deployment.

At the next normal authorized 08:00/08:05/08:10 Aruba execution window on an open business day, verify:

- `technicianDailyScheduleBatches/{date}` has invocation heartbeat evidence;
- invocation metadata contains Scheduler schedule time/job identity when supplied by Firebase;
- expected deterministic queue IDs are recorded;
- `whatsappOutboundQueue` is the delivery authority;
- terminal success is `sent`, `delivered`, or `read`;
- repeated 08:05/08:10 ticks do not create duplicate logical schedule messages;
- batch completion remains monotonic under repeated/overlapping execution.

Do not declare the incident repaired from Cloud Function `ACTIVE` state alone.

## 6. Monitor follow-up

After PR #427 is production-verified and integrated, PR #431 can be integrated after its independent review/CI gates. Then run the read-only Van Schedule Delivery Health workflow against controlled historical/current evidence to verify:

- healthy result does not create an alert;
- unhealthy historical evidence creates one date-scoped issue;
- repeated unhealthy checks update/comment the same issue instead of creating duplicates;
- no WhatsApp send, Scheduler invocation, or DEMAC production write occurs.

## 7. Rollback

If the controlled deployment fails after changing production application code:

- stop and preserve workflow evidence;
- do not create a replacement Scheduler or fallback sender;
- revert to the previously known-good notification producer application commit through the governed Firebase deployment path;
- investigate Scheduler/IAM state separately;
- do not remove canonical queue records or Van/JID mappings as rollback.

## Merge gate for PR #427

PR #427 is merge-ready only when all are true:

- current head CI is green;
- independent Reviewer evidence exists for the same effective code/workflow head;
- issue #428 IAM prerequisite is satisfied;
- controlled exact-SHA deployment passes;
- exact Scheduler post-deploy verification passes;
- a natural automatic schedule window produces heartbeat and correct canonical queue/delivery evidence without duplicate sends.
