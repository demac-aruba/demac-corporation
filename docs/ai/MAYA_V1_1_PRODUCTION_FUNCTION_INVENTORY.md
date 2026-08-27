# Maya V1.1 Production Function Inventory

Status: **DEPLOYMENT DESIGN ONLY — NO PRODUCTION DEPLOYMENT AUTHORIZED**

Reviewed source: Maya V1.1 P0 HEAD `f70665fbb9dbae89d874e05beb0ca58705cb7385`.

This inventory closes the ambiguity around which exported Functions belong to the P0 production path. It does not authorize deployment.

## Current deployment gap

`.github/workflows/customer-agent-production-deploy.yml` currently deploys only:

1. `processCustomerAgentInbound`
2. `processCustomerAgentReactivation`

The reviewed P0 architecture exports additional required surfaces from `functions/bootstrap.js`. Export alone is not deployment evidence.

## Required P0 production surfaces

| Function | Trigger | Canonical source | Secret | Role in rollout | Current explicit production owner |
| --- | --- | --- | --- | --- | --- |
| `wacliWebhook` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Canonical account-scoped inbound webhook | Wacli Connector workflow |
| `wacliMediaIngest` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Canonical bridge media ingest | Wacli Connector workflow |
| `wacliOutboundPoll` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Account-scoped outbound claim / last-mile authorization | Wacli Connector workflow |
| `wacliOutboundAck` | HTTPS | `whatsappWacliGateway.js` | `WACLI_BRIDGE_TOKEN` | Account-scoped outbound acknowledgement | Wacli Connector workflow |
| `wacliOutboundMediaUpload` | HTTPS | `wacliOutboundMediaUpload.js` | none of the bridge secrets | ERP authenticated outbound media staging | Wacli Connector workflow |
| `stampCommunicationMessageFirstSeen` | Firestore document created: `whatsappMessages/{messageId}` | `demacCommunicationIngressMetadata.js` | none | Immutable first-seen/canonical-identity verification metadata | **MISSING** |
| `processCustomerAgentInbound` | Firestore document created: `whatsappMessages/{messageId}` | `demacCustomerAgentAllowlistCommunication.js` | `OPENAI_API_KEY` currently attached | Schedules eligible text/current-turn work; voice without transcript is ignored at create time | Customer Agent Production |
| `transcribeNewCustomerVoiceNote` | Firestore document created: `whatsappMessages/{messageId}` | `voiceTranscription.js` | `OPENAI_API_KEY` | Claims/transcribes newly eligible inbound voice; historical backfill remains prohibited by policy | **MISSING** |
| `transcribeCustomerVoiceWhenReady` | Firestore document updated: `whatsappMessages/{messageId}` | `voiceTranscription.js` | `OPENAI_API_KEY` | Retries/starts voice transcription when media/eligibility metadata becomes ready | **MISSING** |
| `processCustomerAgentVoiceTranscript` | Firestore document updated: `whatsappMessages/{messageId}` | `demacCustomerAgentAllowlistCommunication.js` | `OPENAI_API_KEY` | Converts completed transcript into the same governed Customer Turn path | **MISSING** |
| `processCustomerAgentReactivation` | Firestore document updated: `communicationConversations/{conversationId}` | `demacCustomerAgentAllowlistCommunication.js` | `OPENAI_API_KEY` currently attached | Schedules pending customer turn after explicit return to Maya | Customer Agent Production |
| `processCustomerAgentTurnWakeup` | Cloud Tasks / task-dispatched | `demacCustomerTurnOrchestrator.js` | `OPENAI_API_KEY` | Persistent debounce wakeup; Observer -> policy -> single Customer Runtime | **MISSING** |
| `communicationConversationAuthority` | HTTPS | `communicationConversationAuthority.js` | no declared Functions secret; verifies Firebase ID token and canonical `users/{uid}` profile | Canonical human ownership/status/send command authority | **MISSING** |

## Trigger composition and why these are not duplicate customer runtimes

Three create-time consumers may observe a new `whatsappMessages` document, but they have different authority:

- `stampCommunicationMessageFirstSeen` verifies/stamps ingress identity metadata only;
- `processCustomerAgentInbound` schedules a governed Customer Turn for eligible semantic content and explicitly skips new voice without a transcript;
- `transcribeNewCustomerVoiceNote` only claims eligible inbound voice for shared transcription.

Completed voice then flows through `processCustomerAgentVoiceTranscript` into the same Customer Turn orchestrator. `processCustomerAgentTurnWakeup` is the single deferred execution stage that runs Observer/Case before Reply Policy and the existing Customer Runtime. No additional customer-facing runtime or sender authority is introduced by deploying these triggers.

## Required deployment ownership decision

Do **not** opportunistically add missing functions to unrelated workflows.

Recommended architecture:

### Wacli Connector Production owner
Keep transport-only surfaces under `.github/workflows/wacli-webhook-deploy.yml`:
- `wacliWebhook`
- `wacliMediaIngest`
- `wacliOutboundPoll`
- `wacliOutboundAck`
- `wacliOutboundMediaUpload`

### Maya Communication Production owner
Create one deliberate deployment owner for the governed communication/runtime surfaces:
- `stampCommunicationMessageFirstSeen`
- `processCustomerAgentInbound`
- `transcribeNewCustomerVoiceNote`
- `transcribeCustomerVoiceWhenReady`
- `processCustomerAgentVoiceTranscript`
- `processCustomerAgentReactivation`
- `processCustomerAgentTurnWakeup`
- `communicationConversationAuthority`

The existing Customer Agent Production workflow can either be evolved into this owner in a reviewed rollout change or be superseded by a dedicated workflow. There must be exactly one production deployment owner per Function; do not keep two workflows capable of deploying the same Function.

## Deployment-order dependency

The deployment owner must not activate the Maya Communication surfaces before the Wacli account-bound gateway is healthy.

Required order:

1. account-bound DigitalOcean bridge verified;
2. canonical communication account setting verified;
3. Wacli Connector Production deployed/verified;
4. Maya Communication Production functions deployed/verified;
5. ERP client parity verified against `communicationConversationAuthority`;
6. only then consider the separately approved Firestore Rules cutover;
7. only then activate pilot/voice settings.

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

- Wacli transport rollback: pause/restore through the authorized bridge/gateway recovery path while preserving canonical account-scoped data.
- Maya Communication rollback: disable/pause Maya/voice policy or undeploy the newly activated trigger set only through an approved recovery change. Do not restore legacy raw-chat identity writes or a second sender.
- Security rules rollback must be a separately approved security action; do not use a permissive emergency rule as an unreviewed shortcut.

## Exit criterion for deployment-inventory blocker B3

B3 is closed only when:
1. one production owner is selected for every row above;
2. that owner has deterministic deployment commands and post-deploy verification;
3. duplicate deployment ownership is eliminated;
4. the ordered rollout dependency on the Wacli bridge/gateway is explicit;
5. the resulting workflow change passes Solo Maintainer Adversarial Review before any production execution.
