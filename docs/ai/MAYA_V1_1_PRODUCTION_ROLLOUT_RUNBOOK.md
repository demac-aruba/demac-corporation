# Maya V1.1 Production Rollout Runbook

Status: **PREPARATION ONLY — NO PRODUCTION ACTIVATION AUTHORIZED**

This runbook converts the reviewed Maya V1.1 engineering work into a controlled production-cutover sequence. It does not authorize a merge to `main`, deployment, secret/config change, Firestore Rules change, destructive migration, historical-audio backfill, customer message, or irreversible autonomy.

## Scope and reviewed inputs

- Parent P0 PR: `#436` — reviewed HEAD `f70665fbb9dbae89d874e05beb0ca58705cb7385`.
- Cancellation/reschedule slice: `#440` — reviewed HEAD `dd6a0b602d94eeedc271e53fbc4dc83712348926`.
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

## Current blockers confirmed from repository evidence

### B1 — Production communication account / bridge binding is not yet live-verified

The P0 bridge requires `COMMUNICATION_ACCOUNT_ID` and includes that value in every Firebase connector request. `/health` exposes the bound communication account. The rollout must verify the deployed bridge value equals the canonical Firestore setting before the Firebase gateway is activated.

**Pass evidence required**
- bridge `/health`: `ok=true`, `connectorMode=outbound-only-v1`, expected `communicationAccountId`;
- no pending webhook events, no pending outbound ACKs, no forward/outbound error;
- configured Firestore `businessSettings/whatsapp.communicationAccountId` exactly matches the bridge value.

**Stop condition**
Any mismatch, missing account ID, pending ACKs, dead-letter growth, or connector error blocks rollout.

### B2 — Deployment ordering is not atomic

`DigitalOcean Remote Ops` and `WhatsApp wacli Connector` are independent `main` workflows. A direct merge can start them without cross-workflow ordering.

**Required rollout order**
1. verify/drain current bridge state;
2. install/verify account-bound bridge;
3. verify canonical account configuration/migration readiness;
4. deploy account-bound Firebase Wacli gateway;
5. verify connector endpoints and live bridge polling;
6. only then activate new Maya triggers/authority surfaces.

A direct unordered `main` merge is not an acceptable rollout mechanism until this order is explicitly controlled.

### B3 — New P0 runtime deployment inventory is incomplete

The current Customer Agent production workflow deploys only:
- `processCustomerAgentInbound`
- `processCustomerAgentReactivation`

The P0 bootstrap also exports newer runtime surfaces including `processCustomerAgentTurnWakeup`, Communication ingress metadata, customer voice/transcription integration, and `communicationConversationAuthority`. These require an explicit production deployment owner/inventory; they must not be assumed to deploy merely because they are exported.

**Pass evidence required**
A reviewed deployment matrix listing every required function, trigger type, secret requirement, runtime service account, deployment workflow/step, post-deploy verification and rollback owner.

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

Required explicit approvals must name the exact boundary being approved. Approval to continue engineering is **not** approval to deploy.

Minimum approvals before production activation:
- production bridge/account binding verification and any needed config change;
- production function deployment/merge;
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

Only after bridge/account gate passes:
- deploy Wacli HTTP functions from the reviewed P0 source;
- verify all four bridge endpoints are ACTIVE and Bearer-protected;
- verify account-binding rejection for missing/wrong account;
- verify ERP media upload is isolated from bridge secrets and production CORS remains valid;
- verify live bridge resumes successful polling/forwarding with zero pending ACKs.

**Rollback:** pause affected bridge/gateway traffic; do not revert storage to legacy raw chat IDs after canonical writes begin.

### Phase 5 — Communication Authority and Customer Turn deployment inventory

Deploy only the explicitly approved function set. At minimum the inventory must account for:
- `communicationConversationAuthority`;
- `processCustomerAgentInbound`;
- `processCustomerAgentReactivation`;
- `processCustomerAgentTurnWakeup`;
- required ingress metadata / voice-trigger surfaces exported by the reviewed bootstrap.

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
1. `#436` P0 foundation;
2. validate controlled production cutover and base behavior;
3. `#440` cancellation/reschedule lifecycle slice;
4. keep irreversible mutation flags OFF initially;
5. separately authorize any later mutation-autonomy rollout.

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
