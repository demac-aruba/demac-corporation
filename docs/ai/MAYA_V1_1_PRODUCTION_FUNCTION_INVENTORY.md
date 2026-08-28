# Maya V1.1 Production Function Inventory

Status: **DEPLOYMENT OWNER PREPARED — NO PRODUCTION DEPLOYMENT AUTHORIZED**

Reviewed baseline source: Maya V1.1 P0 HEAD `f70665fbb9dbae89d874e05beb0ca58705cb7385`.
Prepared rollout-control integration: PR `#447`.

This inventory defines which exported Functions belong to the P0 production path, their single deployment owner, and the verification required after an authorized production deploy. It does not authorize deployment.

## Baseline gap and prepared resolution

At the reviewed P0 baseline, `.github/workflows/customer-agent-production-deploy.yml` deployed only:

1. `processCustomerAgentInbound`
2. `processCustomerAgentReactivation`

The P0 architecture exports additional required surfaces from `functions/bootstrap.js`; export alone is not deployment evidence.

PR `#447` prepares the existing Customer Agent Production workflow as the **single manual deployment owner** for all eight governed Maya Communication surfaces. The prepared workflow validates automatically on PR/push but its deployment job requires:

- `workflow_dispatch`;
- `github.ref == refs/heads/main`;
- `confirm_production_deploy == true`.

Therefore B3's engineering ownership ambiguity is resolved in the prepared rollout package, while actual production deployment/live verification remains open.

## Required P0 production surfaces

| Function | Trigger | Canonical source | Secret | Role in rollout | Prepared production owner |
| --- | --- | --- | --- | --- | --- |
| `wacliWebhook` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Canonical account-scoped inbound webhook | Wacli Connector workflow — manual cutover |
| `wacliMediaIngest` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Canonical bridge media ingest | Wacli Connector workflow — manual cutover |
| `wacliOutboundPoll` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Account-scoped outbound claim / last-mile authorization | Wacli Connector workflow — manual cutover |
| `wacliOutboundAck` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Account-scoped outbound acknowledgement | Wacli Connector workflow — manual cutover |
| `wacliOutboundMediaUpload` | HTTPS | `wacliOutboundMediaUpload.js` | none of the bridge secrets | ERP authenticated outbound media staging | Wacli Connector workflow — manual cutover |
| `stampCommunicationMessageFirstSeen` | Firestore document created: `whatsappMessages/{messageId}` | `demacCommunicationIngressMetadata.js` | none | Immutable first-seen/canonical-identity verification metadata | Customer Agent Production — manual Maya deploy |
| `processCustomerAgentInbound` | Firestore document created: `whatsappMessages/{messageId}` | `demacCustomerAgentAllowlistCommunication.js` | `OPENAI_API_KEY` | Schedules eligible text/current-turn work; voice without transcript is ignored at create time | Customer Agent Production — manual Maya deploy |
| `transcribeNewCustomerVoiceNote` | Firestore document created: `whatsappMessages/{messageId}` | `voiceTranscription.js` | `OPENAI_API_KEY` | Claims/transcribes newly eligible inbound voice; historical backfill remains prohibited | Customer Agent Production — manual Maya deploy |
| `transcribeCustomerVoiceWhenReady` | Firestore document updated: `whatsappMessages/{messageId}` | `voiceTranscription.js` | `OPENAI_API_KEY` | Retries/starts voice transcription when media/eligibility metadata becomes ready | Customer Agent Production — manual Maya deploy |
| `processCustomerAgentVoiceTranscript` | Firestore document updated: `whatsappMessages/{messageId}` | `demacCustomerAgentAllowlistCommunication.js` | `OPENAI_API_KEY` | Converts completed transcript into the same governed Customer Turn path | Customer Agent Production — manual Maya deploy |
| `processCustomerAgentReactivation` | Firestore document updated: `communicationConversations/{conversationId}` | `demacCustomerAgentAllowlistCommunication.js` | `OPENAI_API_KEY` | Schedules pending customer turn after explicit return to Maya | Customer Agent Production — manual Maya deploy |
| `processCustomerAgentTurnWakeup` | Cloud Tasks / task-dispatched | `demacCustomerTurnOrchestrator.js` | `OPENAI_API_KEY` | Persistent debounce wakeup; Observer -> policy -> single Customer Runtime | Customer Agent Production — manual Maya deploy |
| `communicationConversationAuthority` | HTTPS | `communicationConversationAuthority.js` | no declared Functions secret; verifies Firebase ID token and canonical `users/{uid}` profile | Canonical human ownership/status/send command authority | Customer Agent Production — manual Maya deploy |

## Trigger composition and why these are not duplicate customer runtimes

Three create-time consumers may observe a new `whatsappMessages` document, but they have different authority:

- `stampCommunicationMessageFirstSeen` verifies/stamps ingress identity metadata only;
- `processCustomerAgentInbound` schedules a governed Customer Turn for eligible semantic content and explicitly skips new voice without a transcript;
- `transcribeNewCustomerVoiceNote` only claims eligible inbound voice for shared transcription.

Completed voice then flows through `processCustomerAgentVoiceTranscript` into the same Customer Turn orchestrator. `processCustomerAgentTurnWakeup` is the single deferred execution stage that runs Observer/Case before Reply Policy and the existing Customer Runtime. No additional customer-facing runtime or sender authority is introduced by deploying these triggers.

## Single deployment ownership decision

Do **not** opportunistically add these Functions to unrelated workflows.

### Wacli Connector Production owner
Transport-only surfaces remain under `.github/workflows/wacli-webhook-deploy.yml`:
- `wacliWebhook`
- `wacliMediaIngest`
- `wacliOutboundPoll`
- `wacliOutboundAck`
- `wacliOutboundMediaUpload`

The prepared rollout requires an explicit Wacli production cutover confirmation plus explicit conditional authorization to retire `sendQueuedWacliMessage` if it still exists. This prevents an approved cutover path from intentionally leaving two sender paths active.

### Maya Communication Production owner
The existing `.github/workflows/customer-agent-production-deploy.yml` is deliberately evolved into the one owner for:
- `stampCommunicationMessageFirstSeen`
- `processCustomerAgentInbound`
- `transcribeNewCustomerVoiceNote`
- `transcribeCustomerVoiceWhenReady`
- `processCustomerAgentVoiceTranscript`
- `processCustomerAgentReactivation`
- `processCustomerAgentTurnWakeup`
- `communicationConversationAuthority`

There must be exactly one production deployment owner per Function; no second workflow may deploy the same Function set.

## Deployment-order dependency

The Maya Communication owner must not activate before the account-bound Wacli gateway is healthy.

Required order:

1. read-only production/account preflight passes;
2. account-bound DigitalOcean bridge deployed/verified under explicit approval;
3. canonical communication account setting verified;
4. Wacli Connector Production deployed/verified and legacy sender absent after authorized retirement;
5. Maya Communication Production functions deployed/verified;
6. ERP client parity verified against `communicationConversationAuthority`;
7. only then consider the separately approved Firestore Rules cutover;
8. only then activate pilot/voice settings.

## Per-function verification contract

Every deployed Function must record:
- exact source Git SHA;
- ACTIVE state;
- region `us-central1`;
- expected trigger type/document path or HTTP endpoint;
- exact secret keys attached (no retired/unrelated secrets);
- runtime service account;
- memory/timeout;
- deployment workflow/run ID;
- negative auth/policy probe where applicable.

Additional checks:

### `communicationConversationAuthority`
- unauthenticated request is rejected;
- inactive/missing/non-authorized `users/{uid}` profile is rejected;
- ownership CAS requires current `ownershipVersion` for guarded commands;
- deterministic request replay succeeds only for the same fingerprint;
- human send creates a governed `conversation_human` outbound queue envelope.

### `processCustomerAgentTurnWakeup`
- task function exists and can be targeted by `getFunctions(app).taskQueue('processCustomerAgentTurnWakeup')`;
- `OPENAI_API_KEY` is attached;
- retries/rate limits match reviewed source;
- no second task handler owns the same queue truth.

### Customer voice functions
- `OPENAI_API_KEY` attached only where transcription/runtime requires it;
- `voiceHistoricalBackfillEnabled` remains false;
- missing activation cutoff fails closed;
- pre-cutoff sample remains ineligible;
- post-cutoff new inbound voice can complete transcription and schedule the same Customer Turn path.

## Rollback ownership

- Wacli transport rollback: pause/restore through the authorized bridge/gateway recovery path while preserving canonical account-scoped data. Never restore a second sender.
- Maya Communication rollback: disable/pause Maya/voice policy or undeploy the newly activated trigger set only through an approved recovery change. Do not restore legacy raw-chat identity writes or a second sender.
- Security rules rollback must be a separately approved security action; do not use a permissive emergency rule as an unreviewed shortcut.

## B3 classification

- **B3a — engineering deployment owner/inventory: READY in the rollout-control integration.**
- **B3b — production deployment and live verification: OPEN / NEEDS_HUMAN before execution.**

B3a is considered complete only while the final integrated workflow continues to pass Solo Maintainer Adversarial Review and CI with its production deployment job skipped outside an explicitly confirmed `workflow_dispatch` on `main`.
