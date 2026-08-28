# Maya V1.1 Pilot Activation Profile

Status: **PREPARED — PRODUCTION SETTINGS NOT AUTHORIZED OR CHANGED**

Reviewed foundation: Maya P0 `f70665fbb9dbae89d874e05beb0ca58705cb7385` plus the governed cancellation/reschedule slice reviewed separately in PR #440.

## Purpose

Define the safest initial production-pilot posture before any settings are changed. This profile deliberately separates:

1. observation;
2. customer reply permission;
3. customer voice transcription;
4. irreversible appointment mutation authority.

No activation timestamp, allowlist, production account value, or business autonomy setting is invented in this document.

## Stage A — deployment verification, Maya effectively silent

Use immediately after the approved Functions/transport cutover while production verification is running.

Required posture:

- `enabled`: may remain false until the operator is ready to test Maya, or true only if all reply/observation gates below are deliberately configured;
- `autoReplyEnabled = false`;
- `observationEnabled = false` until the active communication account and canonical ingress are confirmed live;
- `voiceTranscriptionEnabled = false`;
- `voiceHistoricalBackfillEnabled = false`;
- `autoCancelEnabled = false`;
- `autoRescheduleEnabled = false`.

This stage verifies infrastructure without creating customer-facing Maya behavior.

## Stage B — observation-only pilot

After account/ingress verification:

- `enabled = true`;
- `observationEnabled = true`;
- `autoReplyEnabled = false`;
- `voiceTranscriptionEnabled = false` initially;
- `voiceHistoricalBackfillEnabled = false`;
- `autoCancelEnabled = false`;
- `autoRescheduleEnabled = false`.

Expected behavior:
- eligible active-account inbound text can be analyzed/observed;
- existing-customer normal conversations remain customer-silent;
- no Maya customer reply is permitted by the global reply gate;
- no customer voice note is automatically transcribed yet;
- no irreversible appointment mutation can occur.

Observation-only acceptance should confirm that canonical message identity, Case creation/escalation and dispatch-hold behavior do not cause duplicate sends or ownership violations.

## Stage C — allowlisted reply pilot

After observation-only evidence is clean:

- `enabled = true`;
- `observationEnabled = true`;
- `autoReplyEnabled = true`;
- `replyMode = 'pilot'` or the approved allowlist-only posture;
- `autoReplyAllowlist` contains only the explicitly approved pilot/test contacts;
- `newContactAutoReplyEnabled = false` initially unless the pilot owner separately approves genuine-new-contact autonomy;
- `cancellationAutoReplyEnabled` and `rescheduleAutoReplyEnabled` may remain false for the first reply test and can be enabled separately only after the corresponding workflow acceptance is ready;
- `autoCancelEnabled = false`;
- `autoRescheduleEnabled = false`.

The allowlist is a reply permission only. It does not grant sender ownership when a human owns the conversation and does not grant business-action authority.

## Stage D — customer voice pilot

Voice is activated only after text/current-turn behavior is stable.

Immediately before enabling customer voice, record the exact production activation timestamp. The timestamp must be the actual activation moment; do not backdate it.

Required posture:

- `voiceHistoricalBackfillEnabled = false`;
- choose and record the exact deployed `voiceTranscriptionVersion` before activation;
- set `voiceTranscriptionEnabledAt` (or the canonical equivalent) to the exact activation timestamp;
- then set `voiceTranscriptionEnabled = true`;
- leave `autoCancelEnabled = false` and `autoRescheduleEnabled = false`.

The current implementation defaults the customer-voice retry limit to **3 attempts** when no explicit valid override is configured. An override must remain within the implementation's allowed range and should not be changed solely for rollout convenience.

### Required voice acceptance

Use deliberately controlled samples:

1. a known pre-cutoff audio item remains ineligible and produces no automatic transcription/action;
2. a newly received post-cutoff inbound voice note can be stored, transcribed once, and enter the same governed Customer Turn path;
3. replaying the same provider message does not create another logical turn;
4. an outbound DEMAC audio item never becomes customer intent;
5. human takeover before/during transcript completion suppresses customer-facing Maya work;
6. original audio remains preserved and the transcript remains derived data.

Rollback for voice is `voiceTranscriptionEnabled = false`; existing canonical audio/audit evidence must be preserved.

## Stage E — genuine new-contact pilot

Only after allowlisted text/voice behavior is stable:

- keep `replyMode = 'pilot'`;
- enable `newContactAutoReplyEnabled = true` only with explicit pilot-owner approval;
- existing-customer normal conversation remains observe-only unless separately authorized workflow logic applies;
- canonical CRM/Pricing/Booking tools remain required for business facts and booking;
- missing price remains unknown, never inferred.

This stage must be monitored separately because it expands reply eligibility beyond a static allowlist.

## Stage F — existing-customer cancellation/reschedule conversation

The reply flags are independent:

- `cancellationAutoReplyEnabled` controls whether an authorized cancellation workflow may converse;
- `rescheduleAutoReplyEnabled` controls whether an authorized reschedule workflow may converse.

Enabling either reply flag does **not** enable the corresponding irreversible mutation.

Initial production-pilot requirement remains:

- `autoCancelEnabled = false`;
- `autoRescheduleEnabled = false`.

When mutation is denied/off, Maya may acknowledge a request only within the governed conversation policy and must never claim that the appointment has already been cancelled or rescheduled without canonical same-turn lifecycle proof.

## Irreversible autonomy — separate future gate

`autoCancelEnabled=true` or `autoRescheduleEnabled=true` is not part of the initial rollout profile.

Any future enablement requires a separate explicit human authorization after live pilot evidence covers:

- exact Communication Case appointment binding;
- stale ownership/customer-input rejection;
- wrong appointment rejection;
- cross-account rejection;
- idempotent replay;
- Booking Authority capacity/lifecycle proof;
- zero invalid customer-facing completion claims.

## Cost/duration decision for customer voice

The implementation already has a 25 MB media boundary and bounded transcription attempts. It does not establish a business-approved duration ceiling in this rollout record.

Before broad voice scale, the pilot owner must decide one of:

- **Option A:** controlled pilot accepts existing media-size + retry limits and monitors usage/cost before choosing a duration ceiling; or
- **Option B:** engineering adds a reviewed duration/cost ceiling before voice activation.

Do not invent a duration value merely to close the checklist.

## Activation record

At each stage record:

- UTC timestamp;
- actor/approver;
- exact `main` SHA and deployed Function revisions;
- canonical production communication account ID verification result;
- settings before/after;
- controlled test used;
- outcome and metrics;
- rollback/disable action if needed.

## B5 classification

- **B5a — conservative activation profile: READY.**
- **B5b — exact production voice activation timestamp/version: NEEDS_HUMAN at activation time.**
- **B5c — duration/cost policy for broad voice scale: OPEN business decision.**

No production setting was read or changed while preparing this profile.
