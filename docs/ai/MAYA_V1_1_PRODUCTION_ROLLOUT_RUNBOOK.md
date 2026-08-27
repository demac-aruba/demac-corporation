# Maya V1.1 Production Rollout Runbook

Status: **PREPARATION ONLY — NO PRODUCTION ACTIVATION AUTHORIZED**

This runbook converts the reviewed Maya V1.1 engineering work into a controlled production-cutover sequence. It does not authorize a merge to `main`, deployment, secret/config change, Firestore Rules change, destructive migration, historical-audio backfill, customer message, or irreversible autonomy.

## Scope and reviewed inputs

- Parent P0 PR: `#436` — reviewed HEAD `f70665fbb9dbae89d874e05beb0ca58705cb7385` before rollout-control integration.
- Rollout-control integration: `#447` — prepares manual production gates on top of the P0 without deploying them.
- Cancellation/reschedule slice: `#440` — reviewed HEAD `dd6a0b602d94eeedc271e53fbc4dc83712348926` before inheriting the rollout-control base.
- Governance: Solo Maintainer Adversarial Review mode is already merged to `main` via `#441`.
- Canonical WhatsApp account authority: `businessSettings/whatsapp.communicationAccountId`.
- Canonical scheduling/lifecycle authority: Booking Authority.
- Canonical human ownership/send authority: `communicationConversationAuthority`.
- Canonical customer-facing runtime: Customer Runtime V1.

## Non-negotiable rollout invariants

1. **One communication account identity.** The DigitalOcean bridge `COMMUNICATION_ACCOUNT_ID`, Firebase connector request header, Firestore communication settings, canonical conversation/message identity, and outbound queue account must agree exactly.
2. **Bridge first, gateway second.** The new Firebase Wacli boundary rejects missing/mismatched account binding. Therefore the account-bound bridge must be verified before the account-bound gateway is activated.
3. **One sender owner.** Human ownership always overrides Maya. `ownershipVersion` and `customerInputVersion` must continue to invalidate stale work through the final provider claim.
4. **No direct browser bypass of critical writes after cutover.** Conversation ownership/status transitions and free-form outbound queue creation must converge through backend authority before restrictive Firestore Rules are activated.
5. **No historical voice backfill.** Voice transcription begins only at a deliberate activation cutoff and only for newly received eligible inbound audio.
6. **Mutation autonomy stays OFF by default.** `autoCancelEnabled=false` and `autoRescheduleEnabled=false` unless a later explicit approval changes them.
7. **Rollback must not reintroduce legacy raw-chat identity writes after canonical identity activation.** Post-cutover rollback means disabling Maya/voice/reply capability or pausing the bridge while preserving canonical data.
8. **Production execution is two-step gated.** A production workflow must be manually dispatched on `main` and its explicit confirmation input must be true before any live read/deploy/delete action can run.

## Current blockers confirmed from repository evidence

### B1 — Production communication account / bridge binding is not yet live-verified

The P0 bridge requires `COMMUNICATION_ACCOUNT_ID` and includes that value in every Firebase connector request. `/health` exposes the bound communication account. The rollout must verify the deployed bridge value equals the canonical Firestore setting before the Firebase gateway is activated.

A read-only B1 preflight workflow is prepared in `#447`, but it has not been executed against production. The live job requires an explicit `workflow_dispatch` on `main` plus `confirm_read_only_production_access=true`.

**Pass evidence required**
- bridge `/health`: `ok=true`, `connectorMode=outbound-only-v1`, expected `communicationAccountId`;
- no pending webhook events, no pending outbound ACKs, no forward/outbound error;
- configured Firestore `businessSettings/whatsapp.communicationAccountId` exactly matches the bridge value.

**Stop condition**
Any mismatch, missing account ID, pending ACKs, dead-letter growth, or connector error blocks rollout.

### B2 — Deployment ordering controls are prepared but not production-active

The reviewed P0 baseline had independent DigitalOcean and Wacli `main` workflows whose production jobs could start from a push. `#447` changes the prepared rollout path so:

- DigitalOcean bridge deployment validates automatically but requires `workflow_dispatch` on `main` plus `confirm_bridge_cutover=true` to modify the host;
- Wacli Firebase validates automatically but requires `workflow_dispatch` on `main`, `confirm_production_cutover=true`, and `retire_legacy_sender=true` before cutover/deletion can run;
- Maya Communication Functions validate automatically but require `workflow_dispatch` on `main` plus `confirm_production_deploy=true` before deployment.

These controls are engineering-ready in the rollout branch but are **not production-active until the reviewed rollout package itself reaches `main`**. No direct unordered merge/deploy should be treated as a valid cutover.

**Required rollout order**
1. verify/drain current bridge state;
2. install/verify account-bound bridge;
3. verify canonical account configuration/migration readiness;
4. deploy account-bound Firebase Wacli gateway and retire the legacy sender if it still exists under the same explicitly authorized cutover;
5. verify connector endpoints and live bridge polling;
6. only then deploy/activate new Maya triggers/authority surfaces.

### B3 — P0 runtime deployment inventory/owner is prepared but not deployed

The reviewed P0 baseline Customer Agent production workflow deployed only:
- `processCustomerAgentInbound`
- `processCustomerAgentReactivation`

`#447` prepares the existing Customer Agent Production workflow as the single manual deployment owner for the eight governed Maya Communication surfaces:

- `stampCommunicationMessageFirstSeen`
- `processCustomerAgentInbound`
- `transcribeNewCustomerVoiceNote`
- `transcribeCustomerVoiceWhenReady`
- `processCustomerAgentVoiceTranscript`
- `processCustomerAgentReactivation`
- `processCustomerAgentTurnWakeup`
- `communicationConversationAuthority`

The workflow verifies expected exports, trigger types, secret boundaries, task entry point, and unauthenticated rejection for the Communication Authority. This closes the **engineering ownership ambiguity**, but it is not production deployment evidence until the workflow is on `main`, explicitly authorized, dispatched, and verified live.

### B4 — Firestore direct-write bypass remains

Current Firestore Rules still allow operations users to update selected `communicationConversations` ownership/status fields directly and create `whatsappOutboundQueue` documents with `status='queued'`. Generic operations writes to `businessSettings` also remain available.

This is incompatible with claiming the new backend authorities are unbypassable.

**Required sequence**
1. prove ERP Next clients use `communicationConversationAuthority` for ownership/status/send operations;
2. deploy and verify the authority endpoint;
3. add emulator-based allow/deny evidence for the intended restrictive rules;
4. obtain explicit human approval for the security-rule cutover;
5. deploy restrictive rules only after client parity is proven.

No Firestore Rules change is authorized by this runbook.

### B5 — Voice activation cutoff/cost policy is undecided

The voice pipeline is fail-closed without an activation timestamp and already prohibits historical backfill.

Before activation, explicitly record:
- activation timestamp;
- transcription version;
- whether a duration/cost ceiling is required;
- observation/reply pilot settings;
- rollback action (`voiceTranscriptionEnabled=false`).

### B6 — AD-015 scalability follow-up

The account-scoped outbound poll is correct for controlled pilot volume but scans the retained account queue and filters active state in memory. This is not a rollout blocker for a low-volume controlled pilot, but it is a blocker before broad scale.

Required before scale: bounded indexed active-queue query plus retention/archive policy.

## Controlled rollout phases

### Phase 0 — Human authorization checkpoint

Required explicit approvals must name the exact boundary being approved. Approval to continue engineering is **not** approval to deploy or access production.

Minimum approvals before production activation:
- read-only production preflight access;
- production bridge/account binding deployment and any needed config change;
- production Wacli/Maya Function deployment;
- conditional retirement/deletion of the legacy sender if it still exists;
- Firestore Rules/security cutover;
- voice activation cutoff/settings;
- any irreversible appointment autonomy enablement.

### Phase 1 — Read-only production preflight

Collect without changing production state:
- current `main` SHA;
- current bridge `/health` and service state;
- current deployed Wacli connector function states/secrets shape;
- current deployed Customer Agent function inventory;
- current `communicationConversationAuthority` state;
- current Firestore communication-account value;
- current queue/dead-letter/ACK counts;
- current Maya/voice settings values.

The prepared automated B1 preflight covers bridge health/account identity only; the broader inventory above remains part of the production evidence package.

**Gate:** no unexplained drift from the reviewed architecture.

### Phase 2 — Bridge account binding

Only after explicit approval:
- snapshot bridge health and deployed candidate SHA;
- ensure `COMMUNICATION_ACCOUNT_ID` equals canonical production account;
- deploy account-bound `server-v2.mjs` through the restricted DigitalOcean path;
- verify retired `/v1/send` and `/v1/media` remain 404;
- verify outbound-only health and Firebase reachability;
- verify no pending ACKs/errors.

**Rollback:** restore/pause bridge through the authorized host recovery path while preserving canonical Firebase data. Never restore legacy Firebase-to-Droplet sender ownership.

### Phase 3 — Canonical communication configuration / migration readiness

Before gateway activation:
- verify canonical account value;
- verify any legacy projections that could collide with account-scoped canonical IDs are reconciled according to the approved migration plan;
- preserve raw audit history;
- confirm no second source of truth is introduced.

**Gate:** one account-scoped canonical identity for all new writes.

### Phase 4 — Firebase Wacli gateway

Only after bridge/account gate passes and the legacy-sender retirement boundary is explicitly authorized:
- deploy Wacli HTTP functions from the reviewed source;
- conditionally delete `sendQueuedWacliMessage` if it still exists;
- verify all four bridge endpoints are ACTIVE and Bearer-protected;
- verify account-binding rejection for missing/wrong account;
- verify ERP media upload is isolated from bridge secrets and production CORS remains valid;
- verify the legacy sender is absent after an authorized retirement;
- verify live bridge resumes successful polling/forwarding with zero pending ACKs.

**Rollback:** pause affected bridge/gateway traffic; do not restore a second sender or revert storage to legacy raw chat IDs after canonical writes begin.

### Phase 5 — Communication Authority and Customer Turn deployment inventory

Only after Phase 4 is healthy and explicit Maya Function deployment approval exists, dispatch the prepared Customer Agent Production owner with `confirm_production_deploy=true`.

The approved function set is:
- `stampCommunicationMessageFirstSeen`;
- `processCustomerAgentInbound`;
- `transcribeNewCustomerVoiceNote`;
- `transcribeCustomerVoiceWhenReady`;
- `processCustomerAgentVoiceTranscript`;
- `processCustomerAgentReactivation`;
- `processCustomerAgentTurnWakeup`;
- `communicationConversationAuthority`.

For each function verify:
- ACTIVE state;
- expected trigger type;
- expected secret bindings only;
- runtime service account;
- region/runtime/memory/timeout;
- no duplicate trigger owning the same customer-facing send path.

### Phase 6 — ERP client parity then security-rule cutover

Before rules are restricted:
- verify claim/assign/return/close/status/read/send actions call the backend authority;
- verify stale ownershipVersion conflicts fail closed;
- verify human send creates the governed outbound envelope;
- verify no intended ERP workflow depends on direct critical Firestore writes.

Then, and only with explicit human approval, deploy restrictive Firestore Rules backed by emulator allow/deny tests.

### Phase 7 — Maya pilot activation

Initial pilot settings must remain conservative:
- observation enabled only for the intended active account;
- reply policy limited to approved pilot/test/new-contact/workflow scope;
- `autoCancelEnabled=false`;
- `autoRescheduleEnabled=false`;
- human ownership always wins;
- historical voice backfill disabled.

Start with test/allowlisted numbers and controlled genuine-new-contact handling before broader traffic.

### Phase 8 — Voice activation

Record the exact activation timestamp immediately before enabling voice transcription. Verify a pre-cutoff audio sample is rejected and a new post-cutoff inbound sample enters the shared transcription/current-turn path.

**Rollback:** disable voice transcription; keep original audio and existing transcripts/audit intact.

### Phase 9 — Live acceptance and monitoring

Required live pilot observations:
- duplicate sends = 0;
- cross-account incidents = 0;
- human-ownership violations = 0;
- stale-turn customer sends = 0;
- invented prices = 0;
- invalid appointment mutations = 0;
- dead-letter/pending ACK growth = 0;
- dispatch-hold behavior matches current Case state;
- Papiamento/Spanish/English responses are customer-appropriate.

If any safety invariant is violated, disable/pause the narrowest affected capability first rather than applying an ad-hoc patch in production.

## Merge sequencing for the reviewed PRs

The safest logical dependency order is:
1. integrate the rollout controls into the P0 branch and revalidate that exact P0 HEAD;
2. merge the approved P0/rollout revision to `main` only when production cutover is explicitly authorized;
3. execute the controlled production cutover and validate base behavior;
4. rebase/revalidate `#440` cancellation/reschedule lifecycle slice on the final P0 lineage;
5. keep irreversible mutation flags OFF initially;
6. separately authorize any later mutation-autonomy rollout.

Do not merge `#440` to `main` ahead of the P0 foundation it depends on.

## Evidence record template

For every production phase record:
- UTC timestamp;
- actor/approver;
- exact Git SHA/function revision/config version;
- pre-state;
- action performed;
- verification output;
- pass/fail decision;
- rollback action if used;
- residual risk / follow-up.

## Final readiness definition

Maya V1.1 is **production-pilot ready** only when B1–B5 are closed with evidence, the approved deployment order has completed without invariant violations, and no security/authority bypass remains for the activated workflow. AD-015 may remain as a documented controlled-pilot scalability follow-up but must be closed before broad scale.
