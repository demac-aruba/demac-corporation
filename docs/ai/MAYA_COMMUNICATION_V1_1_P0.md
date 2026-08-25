# Maya AI Agent & Communication Center Engineering Specification V1.1 — P0 implementation record

Status: active implementation branch; not production-activated.
Base audited: `main` at `ac59100c36c2af2fd188d423d6264fff98df1d12` (2026-08-24).

## Objective

Evolve the existing Customer Agent and Communication Center architecture without creating a second Maya runtime, second Booking Authority, second WhatsApp queue, or parallel pricing/cancellation authority.

The P0 invariant is:

`Communication ingress -> canonical message/conversation -> Observer/Reply policy -> one Customer Runtime -> governed domain tools`

Observation, reply permission, sender ownership, and business-action authority are separate decisions.

## Task contract — Understand objective

### Context

- Request/source: Maya AI Agent & Communication Center Engineering Specification V1.1 plus the DEMAC Engineering Master Protocol.
- Product surface/users: DEMAC Communication Center, Maya Customer Runtime, office/operators, Booking/dispatch operations, and customers contacting the active DEMAC corporate WhatsApp account.
- Business outcome: prevent important inbound customer communication from being missed while keeping customer replies and ERP mutations governed. In particular, Maya must be able to observe and understand eligible inbound text and newly received eligible voice notes, detect operationally dangerous cancellation/reschedule intent even outside office hours, protect dispatch while a request is unresolved, and use canonical ERP authorities for any customer-facing or business action.
- This is not a chatbot rewrite. Maya is an interpreter/orchestrator; canonical DEMAC authorities remain the source of truth.

### Scope

#### In scope for the P0 branch

- account-scoped communication identity and replay/idempotency safety;
- backend authority for critical conversation ownership/sending transitions;
- monotonic ownership/version semantics and stale-Maya suppression;
- explicit separation of Observation, Reply Permission, Conversation Ownership, and Business Action Authority;
- shadow Observer for eligible inbound communication;
- durable Communication Case/attention state for material operational intent;
- cancellation/reschedule detection and appointment correlation without guessing;
- governed dispatch hold/readiness protection without creating a second appointment status;
- canonical Booking Authority integration for scheduling/cancellation/reschedule truth;
- shared transcription infrastructure reused by technician and customer voice consumers;
- automatic transcription eligibility for NEW eligible inbound customer audio only;
- convergence of text/transcript into the same Customer Runtime/current-turn model;
- preservation of unknown-price/no-invention behavior;
- critical P0 regression, authorization, concurrency, replay, stale-work, and failure-path evidence.

#### In scope for Pilot V1.1 completion, but not necessarily this P0 PR

- authorized existing-customer cancellation/reschedule conversation flow;
- genuinely new-contact autonomous booking through canonical CRM/Pricing/Booking tools;
- new-contact entry through text or voice;
- operator-visible voice/transcript surfaces;
- Maya Activity History / Cancellations / Escalations operational UI;
- Overnight Changes and relevant collaboration/readiness surfaces;
- Aruba Papiamento customer-response QA/refinement.

These items remain part of the original V1.1 objective. They must not be silently declared complete because the P0 foundation exists.

#### Out of scope / non-goals

- autonomous technical HVAC diagnosis;
- automatic refunds or payment-dispute resolution;
- price overrides or discounts;
- unrestricted replies to all historical/existing customers;
- Maya-generated audio replies;
- historical WhatsApp voice transcription/backfill;
- full PBX/call-center implementation;
- unrelated ERP redesign or unrelated technical-debt cleanup;
- any second Customer, Booking, Pricing, Appointment, WhatsApp, Inventory, Work Order, or audit system of record.

### Governance

- Communication truth/transactional WhatsApp: canonical Communication Authority and configured provider (`wacli` unless canonical configuration says otherwise).
- Scheduling/capacity/cancellation/reschedule truth: Booking Authority with commit-time revalidation.
- Customer/Property identity: canonical CRM records/services.
- Pricing/duration: approved company rules/settings/catalog hierarchy; Maya may never infer a missing value.
- AI actions: approved Customer Runtime + governed tool registry + explicit pilot policy/feature flags.
- Transcription: one shared DEMAC transcription capability; original media remains canonical evidence and transcript is derived data attached to that message.
- Relevant protected business rules: `COMMS-001` through `COMMS-007`, `PRICE-*`, scheduling/capacity rules consumed by Booking Authority, and the authority/conflict rules in `docs/ai/AUTHORITY_MATRIX.md`.
- Relevant known failure guards: `FP-002`, `FP-003`, `FP-004`, `FP-005`, `FP-006`, `FP-007`, `FP-008`, `FP-009`, `FP-010`, `FP-014`, `FP-017`, and `FP-018` where applicable.
- Architecture debt touched but not erased by partial mitigation: `AD-005` (communication paths), `AD-009` (dispatch readiness/projection), and `AD-012` (superseded architecture assumptions). Close or amend debt only with verifying evidence.
- Security/privacy impact: communication-account isolation, authenticated/authorized backend mutations, protected customer media, server-side OpenAI credentials, replay protection, least-privilege behavior, and no customer/media secrets in logs.
- Legacy parity impact: this work evolves ERP Next/backend communication architecture; it must not copy Legacy patch chains. Existing Wacli behavior, technician transcription, Booking Authority, and technician schedule behavior are regression obligations.

### Acceptance criteria — P0 branch

P0 is complete only when all of the following are supported and evidenced, not merely implemented in isolated helpers:

- [ ] Eligible inbound customer messages are represented under a stable account-scoped communication identity; the same remote number on different communication accounts cannot share conversation/action identity.
- [ ] Provider retries/replays are idempotent: one logical inbound event produces at most one logical case transition, hold, transcription, Maya turn, and allowed reply.
- [ ] Observation, reply permission, ownership, and business-action authority are independently enforced.
- [ ] Human takeover always wins and invalidates stale pending Maya customer sends and business mutations, including during debounce/model/tool/final-commit windows.
- [ ] Current customer turn wins over stale earlier intent; debounce/coalescing does not use blocking sleep and revalidates before action.
- [ ] Existing-customer normal questions can be observed without automatically enabling unrestricted customer replies.
- [ ] Cancellation/reschedule intent is detectable during office hours, after hours, overnight, and weekends whenever Observation is enabled.
- [ ] Ambiguous identity or multiple plausible appointments never cause Maya to guess; the system clarifies when allowed or creates/escalates internal attention.
- [ ] High-confidence unresolved cancellation/reschedule risk can create one governed dispatch hold/readiness protection without marking the canonical appointment cancelled.
- [ ] Technician/dispatch projections do not treat an active held job as safe to dispatch.
- [ ] Permanent cancellation and reschedule commits remain inside Booking Authority, including commit-time availability revalidation.
- [ ] Missing canonical price produces no invented price.
- [ ] Technician voice transcription still uses the shared service and remains regression-compatible.
- [ ] Customer voice auto-transcription is inbound-only, active-account-only, post-activation-only, first-seen/provider-timestamp guarded, version-idempotent, and fail-closed when age/account is uncertain.
- [ ] Historical audio and replayed pre-activation audio produce zero automatic transcription and zero automatic Maya action.
- [ ] Original customer audio is preserved; transcript is derived data on the same canonical message/media identity.
- [ ] Text and voice transcript enter the same Maya Observer/Customer Runtime/current-turn semantics; no separate voice/cancellation Maya brain exists.
- [ ] Transcription failure or ambiguous transcript cannot be treated as invented customer content or trigger irreversible mutation.
- [ ] Outbound DEMAC text/image/audio never becomes inbound customer intent.
- [ ] Material operational decisions are auditable without storing or exposing private chain-of-thought.

The specification's 30 required P0 regression scenarios are the minimum named scenario set; they require appropriate unit/integration/e2e placement rather than one over-mocked suite.

### Acceptance criteria — overall Pilot V1.1

The original V1.1 objective is technically complete only when, in addition to P0 safety, the system supports all Definition-of-Done capabilities from the master specification, including:

- Maya observes eligible inbound conversations and understands eligible text plus NEW eligible voice notes;
- historical audio/replay safety remains proven;
- test-number behavior follows explicit authorization;
- genuinely new contacts can be handled under pilot policy through text or voice and can reach canonical booking when accepted;
- existing customers remain observe-only for normal general conversation while specifically authorized cancellation/reschedule workflows may communicate;
- cancellation detection works outside office hours and unresolved high-confidence risk protects dispatch;
- Booking Authority remains canonical for appointment lifecycle and availability;
- no invented pricing;
- human takeover suppresses all stale Maya customer actions;
- communication-account isolation prevents cross-account contamination;
- Maya Activity History is auditable;
- operators can see original audio and transcript;
- Aruba Papiamento responses meet the approved Aruba standard;
- all P0 regression tests and all relevant repository quality gates pass.

### Failure / denial behavior

Fail closed instead of guessing when any of these are uncertain or invalid:

- communication account identity or active-account membership;
- provider message age / immutable first-seen evidence for automatic voice transcription;
- conversation ownership/version;
- customer/property/appointment correlation;
- more than one plausible appointment;
- current-turn freshness;
- stale Booking Authority offer/availability;
- missing canonical price/policy/business data;
- transcription failure/low-confidence meaning;
- authentication/authorization;
- governed tool/provider failure.

A denied customer reply must not prevent safe observation/internal attention when Observation Policy permits it. A denied business mutation must not be converted into an ungoverned direct Firestore/browser write.

### Human-only boundaries

`NEEDS_HUMAN` is required before any of the following:

1. production deployment, merge to `main`, production customer send/activation, or production provider/config rollout;
2. secret/credential rotation or production access/security-rule change;
3. destructive migration or production-data deletion;
4. creation of a new system of record/source of truth or a new persistent audit ledger when an approved existing authority cannot be reused;
5. setting/verifying the canonical active corporate `communicationAccountId` against the deployed Wacli bridge for production activation;
6. setting the production customer-voice activation cutoff (`voiceTranscriptionEnabledAt` or canonical equivalent);
7. enabling permanent automatic appointment cancellation (`autoCancelEnabled`) or advancing to P3 autonomy;
8. any future historical-audio transcription workflow beyond explicit manual, authorized, auditable handling of an individual item.

Safe implementation, tests, documentation, and local/CI validation that do not cross these boundaries may continue.

### Evidence required before P0 can be called complete

- repository diff limited to intended Maya/Communication/Booking/dispatch/transcription surfaces;
- exact authority/business-rule impact documented;
- Functions syntax validation: `npm run validate:firebase --prefix functions`;
- focused/relevant Functions test suites, including customer-agent, communication authority, transcription, Booking Authority, dispatch safety, and transactional WhatsApp consumers;
- ERP Next typecheck plus relevant Communication Center tests and release-impacting build when the frontend surface is changed;
- negative authorization tests and fail-closed cases;
- concurrency/stale ownership tests at takeover during debounce/model/tool/final-send boundaries;
- provider replay/idempotency tests;
- cross-account identity/isolation tests;
- historical audio/new-only/duplicate audio/transcription failure tests;
- integration evidence for inbound -> canonical message -> Observer -> Communication Case -> appointment correlation -> dispatch hold/readiness, without over-mocking the critical path;
- integration evidence for inbound audio -> media -> transcription -> same current turn -> Reply Policy -> governed workflow;
- technician transcription and technician schedule regressions;
- current CI workflows relevant to transitive consumers green on the final reviewed HEAD;
- four explicit review passes: Correctness, Architecture, Integration/Regression, Production Readiness;
- independent Reviewer evidence distinct from the Builder pass, as required by `AGENTS.md`;
- remaining risk, rollback/disable strategy, feature flags/kill switches, and `NEEDS_HUMAN` items recorded;
- explicit statement that no production deploy, irreversible action, production send, or unauthorized activation occurred.

### Current branch completion semantics

The existing draft PR may be green while still not be complete. Passing CI proves only the checks that actually ran against that HEAD. P0 must not be promoted to "done" until the named critical-path acceptance evidence above exists. Pilot V1.1 must not be promoted to "done" until its broader Definition of Done is also met.

## Existing authorities confirmed

- Wacli/Firebase communication ingress: `functions/whatsappWacliGateway.js`.
- Canonical Customer Runtime: `functions/demacCustomerAgentRuntimeV1.js`.
- Customer Agent queue, lease, current-turn suppression, and final outbound guard: `functions/demacCustomerAgentCommunication.js`.
- Existing pilot reply gate: `functions/demacCustomerAgentReplyPolicy.js` + `functions/demacCustomerAgentAllowlistCommunication.js`.
- Booking commit/cancel/reschedule authority: `functions/bookingAuthorityAppointmentLifecycle.js` and Booking Authority facades.
- Existing technician voice transcription: `functions/voiceTranscription.js`.
- Canonical WhatsApp outbound queue: `whatsappOutboundQueue` through the existing communication transport.

## Gap matrix

| Requirement | Current authority / implementation | Status | Gap | P0 change | Risk | Required regression |
| --- | --- | --- | --- | --- | --- | --- |
| Canonical inbound direction | Wacli gateway uses `payload.FromMe === false` | PASS | None for the known regression | Preserve; reject unknown direction for intent | High if regressed | outbound text/image/audio never wakes Maya |
| Observation != reply | Allowlist wrapper stores `observe_only` but returns before runtime | PARTIAL | Observe-only is effectively no analysis | Introduce explicit observation policy and Observer path before general reply expansion | High | existing-customer normal question observes with no customer send |
| Human sender wins | Conversation owner fields + runtime/final-send checks | PARTIAL | No monotonic ownership epoch | Add `ownershipVersion` contract and backend command authority before broad autonomy | Critical | takeover during debounce/model/tool commit suppresses stale work |
| Account isolation | Conversation/message identity is mainly chat/message ID | FAIL for multi-account | `communicationAccountId` is not first-class end-to-end | Add canonical communication identity helpers and fail-closed account policy; migrate command/ingress identity deliberately | Critical | same remote number on two accounts cannot cross-contaminate |
| Provider replay idempotency | Message docs and outbound IDs are mostly stable by provider message ID | PARTIAL | account is absent from keys; first trusted ingestion time is not immutable | Add account-aware identity contract and immutable first-seen metadata before voice activation | High | three webhook replays -> one logical message/action |
| Debounce/current turn | Queue coalescing + newer-message check exists | PARTIAL | processing starts immediately; no 10–15 s eligibility window | Add deferred `eligibleAt` semantics without blocking sleeps | High | cancel then keep/reschedule during debounce cannot execute stale intent |
| Customer voice understanding | Communication Center stores/playbacks audio; Customer Runtime consumes text/caption/reaction | FAIL | audio is not transcribed into the same turn | Extract shared transcription service + new-only eligibility; transcript remains attached to canonical message | High | new voice cancellation; audio + follow-up text; duplicate audio webhook |
| Historical voice safety | No customer auto-transcription exists yet | SAFE but missing capability | Activation cutoff/new-only contract absent | Add fail-closed eligibility before any customer voice trigger is activated | Critical | old audio and replayed old audio produce zero transcription/action |
| Cancellation mutation | Booking lifecycle already owns cancel/reschedule | PASS authority | Maya lacks governed request/hold workflow | Reuse lifecycle; add request/dispatch safety without direct appointment writes from Maya | Critical | Sunday-night cancellation protects dispatch without falsely marking cancelled |
| Dispatch safety | Technician schedule excludes canonical cancelled statuses | PARTIAL | unresolved cancellation hold is not represented | Introduce one derived readiness/hold projection, not another appointment status | Critical | held job not treated as safe to dispatch |
| Pricing | Customer Runtime already requires ERP pricing tools | PASS foundation | New workflows must not bypass it | Preserve unknown-means-unknown | High | canonical price unavailable -> zero invented price |
| Conversation commands | Some ERP Next operations still mutate Firestore directly from browser helpers | FAIL target architecture | No single backend command service for ownership transitions | Converge claim/release/assign/return/close/reopen/send mutations behind backend authority | Critical | authorization + ownership epoch + idempotency tests |
| Maya audit/history | Existing lifecycle/conversation data has partial traceability | PARTIAL | no approved unified Maya operational projection yet | Reuse canonical lifecycle/case/audit evidence; do not invent a parallel log DB | Medium | material decisions traceable without chain-of-thought |

## Root causes

1. Pilot reply safety was implemented as an allowlist wrapper around an otherwise capable runtime. That was correct for preventing unwanted sends, but `observe_only` currently exits before semantic analysis, so it cannot detect cancellation risk.
2. Conversation identity predates multi-account isolation. `chat` is effectively used as both remote identity and local conversation document identity.
3. The Customer Agent queue has useful coalescing and stale-result suppression, but it is not yet a true deferred 10–15 second turn aggregator.
4. Technician transcription is consumer-specific at the trigger layer even though its lower-level audio retrieval/OpenAI work is reusable.
5. Communication Center ownership transitions remain partly browser-driven, preventing one atomic place to advance an ownership epoch and invalidate autonomous work.

## P0 implementation order

1. Add central, testable communication-account identity and Maya policy primitives without changing production behavior.
2. Extract one shared DEMAC transcription service and keep technician behavior equivalent.
3. Add fail-closed customer voice eligibility rules: inbound only, active account, activation cutoff, trusted provider timestamp, immutable first-seen timestamp, transcription version, no historical backfill.
4. Persist immutable ingress/account metadata and media storage provenance required by the eligibility check.
5. Extend the existing Customer Runtime/queue so voice transcript and nearby text converge into one current customer turn.
6. Replace browser ownership mutations with a backend Conversation Command Authority and add monotonic `ownershipVersion` checks around model/send/business commits.
7. Add shadow Observer and cancellation Communication Case flow.
8. Add Booking Authority cancellation-request/dispatch-hold integration and technician/dispatch projection protection.
9. Add the required P0 regression suite, then P1 UI/history/overnight surfaces.

## Explicit safety boundaries

This branch must not:

- merge itself to `main`;
- deploy Firebase/Vercel/production code;
- send production/customer messages;
- change production secrets, IAM, Firestore/Storage access rules, or provider configuration;
- run historical audio backfill;
- activate unrestricted Maya autonomy;
- auto-cancel appointments while `autoCancelEnabled` is false;
- create a second Booking, Pricing, WhatsApp, Customer, Appointment, or Inventory authority.

## Human-only activation boundary

`NEEDS_HUMAN` before production activation of account-scoped conversation IDs or customer voice transcription: the active corporate communication account identity and voice activation timestamp must be deliberately configured and verified against the deployed Wacli bridge. Unknown account identity or uncertain message age must fail closed.

Any new persistent audit/event ledger beyond already-approved canonical lifecycle/case records also remains `NEEDS_HUMAN` unless an existing approved audit authority is identified and reused.

## Architecture design — post root-cause and duplication audit

This section supersedes only implementation assumptions that the later audit disproved. It does not replace the Objective, governance, acceptance criteria, or canonical authority documents above.

### Confirmed current state and corrected finding

The production-oriented Wacli connector contract is the outbound-only **poll/ack** design introduced by the August 17 cutover. Firebase exposes `wacliWebhook`, `wacliMediaIngest`, `wacliOutboundPoll`, and `wacliOutboundAck`; the retired Firebase-to-Droplet `sendQueuedWacliMessage` path must not be reintroduced. The deployment-oriented DigitalOcean source is `ops/digitalocean/deploy/server-v2.mjs`, which polls Firebase and posts durable acknowledgements using the existing Bearer bridge token. `services/whatsapp-bridge/server.mjs` and its README are therefore not the runtime authority for the current deployed connector and must not be used to resurrect the retired push sender.

The remaining P0 architecture problem is not transport selection. It is that account identity, current-turn identity, and ownership/current-input epochs do not yet flow end-to-end through canonical ingress, Maya work, outbound claim, and final send.

### Proposed end-to-end architecture

`Wacli event -> DigitalOcean bridge -> authenticated account-bound Firebase ingress -> canonical account-scoped message + conversation transaction -> deferred Maya turn queue -> canonical customer turn -> Observer -> Communication Case / Dispatch Safety -> Reply Policy -> one Customer Runtime when allowed -> governed tools -> one whatsappOutboundQueue -> account-bound Wacli poll/claim with epoch validation -> bridge send -> durable ACK -> canonical outbound message`

Voice remains the same path: original audio is canonical evidence, transcript is derived data on the same message, and transcript readiness wakes the same input/turn without creating a second message or a second agent.

### Architecture decision matrix

| Area | Current state / finding | Root cause / requirement | Smallest architecturally correct change | Source of truth | Primary affected files | Risk / regression risk |
| --- | --- | --- | --- | --- | --- | --- |
| Communication account boundary | Transport config already lives under `businessSettings/whatsapp`; bridge authentication already uses `WACLI_BRIDGE_TOKEN`; no first-class account binding exists end-to-end. | An authenticated bridge request must identify the DEMAC communication account before any canonical ID is created. Account must never be inferred from the remote customer's number. | Add canonical `communicationAccountId` to the existing WhatsApp transport settings and a required non-secret deployment binding `COMMUNICATION_ACCOUNT_ID` on the DigitalOcean bridge. Bridge sends it on webhook/media/poll/ack requests; Firebase authenticates the Bearer first, then compares the asserted account to canonical transport settings and fails closed on missing/mismatch. Existing `wacliActiveAccountPhone` and projection generation remain cutover metadata, not competing account IDs. | `businessSettings/whatsapp.communicationAccountId`; bridge env is a deployment assertion, not an independent authority. | `ops/digitalocean/deploy/server-v2.mjs`, `functions/whatsappWacliGateway.js`, `functions/demacCommunicationIdentity.js`, transport settings consumers. | Critical: wrong binding can isolate or misroute all Wacli traffic. Production value/configuration is `NEEDS_HUMAN`. |
| Canonical conversation/message identity | Gateway still creates conversation/message/media identities from raw `chat`/`messageId`; the post-create ingress metadata trigger can only detect conflicts after a collision. | Account isolation and provider replay idempotency must exist before first canonical write. | Extend `demacCommunicationIdentity` rather than create another identity layer. Use `canonicalConversationDocumentId` and add one canonical provider-message document-ID helper there. Inbound message + conversation are created/updated transactionally under account-scoped IDs; remote IDs remain data. Receipt/status/media/avatar paths become account-scoped. `demacCommunicationIngressMetadata` becomes provenance/immutable-first-seen verification, not identity repair. | `demacCommunicationIdentity` for identity logic; `communicationConversations` + `whatsappMessages` for canonical records. | `functions/demacCommunicationIdentity.js`, `functions/whatsappWacliGateway.js`, `functions/demacCommunicationIngressMetadata.js`, related tests. | Critical: cutover can split live conversations if legacy projection is not migrated deliberately. |
| Provider replay + customer input epoch | Queue dedup is message-based, but conversation current input has no monotonic epoch. | One provider message must increment customer state once; late/replayed work must not become current. | In the same canonical ingress transaction, a newly created unique inbound customer message increments `communicationConversations.customerInputVersion` exactly once and stores that version on the message. Replays of the same canonical provider-message document do not increment it. Voice transcript completion preserves the original version; it never creates a second customer input version. | Canonical conversation `customerInputVersion`; canonical message stores its assigned immutable input version. | `functions/whatsappWacliGateway.js`, `functions/demacCommunicationIdentity.js`, `functions/voiceTranscription.js`. | High: off-by-one/replay errors can suppress a valid turn or revive stale intent. |
| Canonical current customer turn | Wrapper, Agent, Observer, and voice path currently derive customer content differently; an audio placeholder can be re-read instead of the transcript. | Text, voice transcript, and nearby follow-up text need one current-turn interpretation. | Add one small pure shared current-turn module only because no correct reusable abstraction exists. It selects eligible semantic customer content (completed voice transcript first for voice; otherwise text/caption/reaction; never `[Audio]` as intent), builds the contiguous turn after the last outbound/human boundary, and carries `customerInputVersion`. Observer and Runtime consume the same result. | Canonical messages/conversation are data truth; shared turn helper is the sole derivation logic. | New pure `functions/demacCustomerTurn.js` + tests; refactor `demacCustomerAgentCommunication.js`, `demacCustomerObserverCommunication.js`, `demacCustomerAgentRuntimeV1.js`, wrapper. | High: incorrect grouping can merge separate intents or omit follow-up corrections. |
| Deferred debounce | Existing `customerAgentInboundQueue` starts immediately and only suppresses a result if something newer already arrived. Repository has no reusable scheduler/task queue implementation. | Target is ~12 seconds without blocking sleep; current customer turn must win. | Keep `customerAgentInboundQueue` as the only persistent work state. Store `eligibleAt = latestInboundAt + maya.debounceMs` and expected epochs. Use one Firebase/Cloud Tasks wake-up as execution transport only; task payload contains canonical account/conversation identity, not business state. At-least-once/duplicate wake-ups are harmless because Firestore lease + epochs decide truth. Older wake-ups no-op when a newer input moved eligibility forward. | `customerAgentInboundQueue`; task queue is not business truth. | `functions/demacCustomerAgentCommunication.js`, wrapper/observer trigger wiring, `functions/bootstrap.js`, task-handler tests/config. | High: missed wake-up delays Maya; duplicate wake-up must never duplicate an action. Task-queue production deployment is `NEEDS_HUMAN`. |
| Ownership and stale-work invalidation | Backend commands advance `ownershipVersion`; Runtime checks current ownership but queued Maya work does not capture an expected epoch, and takeover-then-return can make stale work look AI-owned again. | Human sender always wins across debounce/model/tool/final-send, including takeover then return to Maya. | Capture `expectedOwnershipVersion` and `expectedCustomerInputVersion` when work becomes eligible. Extend the existing Runtime execution guard to require exact epoch equality before model, every business tool, and final response. Revalidate both transactionally before Maya outbound queue creation. System-driven escalation/failure must reuse an internal transaction path of `communicationConversationAuthority` so it also advances the ownership epoch; do not directly write a competing ownership state. | `communicationConversations.ownershipVersion` written only by Communication Conversation Authority; `customerInputVersion` written only by canonical inbound ingress. | `functions/communicationConversationAuthority.js`, `functions/demacCustomerAgentCommunication.js`, `functions/demacCustomerAgentRuntimeV1.js`, ownership tests. | Critical: a false positive blocks Maya safely; a false negative lets stale Maya send/mutate after human intervention. |
| Customer Agent session identity | Session ID is provider + conversation and retains JID/phone fallbacks. | Same remote party on different accounts cannot share Maya state. | Extend existing session identity to consume canonical account/channel/provider/conversation identity and fail closed for autonomous state when canonical identity is absent. Migrate only active sessions needed at cutover; do not create another session store. | `customerAgentSessions`, keyed from canonical communication identity. | `functions/demacCustomerConversationState.js`, Runtime callers/tests. | High: wrong migration can lose active offer context or cross-contaminate accounts. |
| New-contact / existing-party classification | Case lookup primarily queries `clients`; canonical Contacts/assignments exist elsewhere. | "Genuinely new" must mean first canonical communication identity with no unique CRM party match, not merely "phone not found in clients". | Extend `customerContactDirectory` with read-only communication-party resolution across active Clients + Contacts, returning one canonical client, ambiguous, or none. Maya may classify new-contact autonomy only when CRM resolution is none **and** this is the first canonical inbound input for the conversation. Ambiguity fails closed. | Canonical CRM: Clients, Contacts, Contact Property Assignments. | `functions/customerContactDirectory.js`, `demacCommunicationCaseService.js`, wrapper/reply-policy context, tests. | High: false-new classification could grant autonomy to an existing customer. |
| Observer + Case ordering | Observer/Case can process retries or older observations concurrently; Case history rewrites from a prior read; dispatch hold is a separate transaction. | Current turn must win and stale cancellation/reschedule must not leave a hold or overwrite a newer withdrawal. | Observation processing carries `customerInputVersion`. Case transaction rejects lower versions and replays the same version/fingerprint idempotently. Refactor Dispatch Safety to expose transaction-compatible mutation helpers so Case state + appointment/work-order hold/release can be committed in the same Firestore transaction after verifying the current conversation epoch. Keep the same `communicationCases` collection and same derived `dispatchHold`; no reconciler or second appointment status. | `communicationCases` for workflow state; Booking appointment for canonical appointment truth; Dispatch Safety for derived readiness. | `functions/demacCustomerObserverCommunication.js`, `demacCommunicationCaseService.js`, `bookingAuthorityDispatchSafety.js`. | Critical: non-atomic stale hold can send/withhold a technician incorrectly. |
| Booking lifecycle convergence | Successful canonical cancel/reschedule does not yet guarantee the derived hold projection is resolved in the same operation. | Once Booking Authority commits the change, no stale `do_not_dispatch` projection may remain. | Reuse the same transaction-compatible Dispatch Safety mutation helper inside Booking lifecycle. Successful cancel releases the unresolved-change hold while cancelled status itself remains non-dispatchable; successful reschedule releases the hold and recalculates readiness for the new canonical appointment state. | Booking Authority appointment lifecycle; Dispatch Safety is derived only. | `functions/bookingAuthorityAppointmentLifecycle.js`, `bookingAuthorityDispatchSafety.js`, work-order/technician schedule regressions. | Critical: stale hold or premature ready projection changes dispatch behavior. |
| WhatsApp outbound queue and sender authority | One queue is correct; human replies already carry `communicationAccountId` + expected ownership, Maya and transactional producers are inconsistent; poller does not enforce those fields. | Exactly one transport queue, but conversation sends must be governed differently from transactional notifications. | Standardize one envelope in `whatsappOutboundQueue`: `communicationAccountId`, `outboundClass` (`conversation_human`, `conversation_maya`, `transactional`), provider, creator, and conversation/expected epochs when applicable. Bridge poll supplies its account ID. Firebase claim only returns commands for that account. `conversation_human` validates current owner + ownership epoch; `conversation_maya` validates ownership + customer-input epochs and current reply enablement; `transactional` remains independent of conversation ownership but is still account/provider scoped. ACK records what was physically sent and must not be rejected because ownership changed after the send. | Existing `whatsappOutboundQueue`; Communication Authority for conversational permission; Transactional WhatsApp authority for notifications. | `functions/whatsappWacliGateway.js`, `communicationConversationAuthority.js`, `demacCustomerAgentCommunication.js`, `whatsappTransactionalService.js`, DigitalOcean bridge. | Critical: over-broad guard can break appointment/van notifications; under-broad guard permits stale Maya sends. |
| Trigger surface | Agent internal module declares trigger definitions while pilot wrapper also owns deployed triggers; Observer has a parallel trigger path. | Policy/turn orchestration must not be bypassable by exporting the wrong module. | Refactor `demacCustomerAgentCommunication.js` into a pure queue/runtime service. Keep the existing wrapper as the customer-communication trigger/policy entrypoint and make broad observation enqueue the same deferred turn even when reply is denied. Refactor Observer communication code into the stage invoked by the shared turn processor. During deployment migration, any old deployed trigger name must be retired deliberately; do not assume removing an export deletes a deployed function. | `bootstrap.js` is the only Firebase export surface; shared turn queue owns deferred Maya processing. | `functions/bootstrap.js`, `demacCustomerAgentAllowlistCommunication.js`, `demacCustomerAgentCommunication.js`, `demacCustomerObserverCommunication.js`. | High: accidental duplicate triggers can double model/case/send activity. |
| Bridge source / CI drift | Runtime-oriented DigitalOcean source is under `ops/digitalocean/deploy/server-v2.mjs`; `services/whatsapp-bridge` is stale/parallel documentation/source. Wacli PR CI validates Firebase files but not the DigitalOcean source, while main pushes to `ops/digitalocean/deploy/**` trigger remote operations. | Do not resurrect superseded bridge architecture; bridge changes need pre-merge validation before a main push can trigger remote ops. | Treat `ops/digitalocean/deploy/server-v2.mjs` as deployment source. Update stale `services/whatsapp-bridge` documentation to point at the canonical source instead of maintaining two implementations. Extend PR validation to syntax/contract-test the DigitalOcean bridge source. Do not merge/deploy it without human approval. | `ops/digitalocean/deploy/server-v2.mjs` for deployed bridge source; workflows define deployment boundary. | `ops/digitalocean/deploy/server-v2.mjs`, `.github/workflows/wacli-webhook-deploy.yml`, `services/whatsapp-bridge/README.md`; no runtime reliance on stale server copy. | High operational risk because `main` changes under `ops/digitalocean/deploy/**` can trigger remote ops. |
| Quality gates | HEAD CI is green but explicit `functions/package.json` validation/test lists omit several new P0 modules/tests. | Green must cover the actual transitive P0 surface. | Extend existing explicit gates with Observer, Case, Dispatch Safety, Ingress, turn/epoch tests and bridge contract checks. Do not weaken current suites or switch to a broad glob merely to simplify maintenance without separate evidence. | Existing repository quality-gate scripts/workflows. | `functions/package.json`, customer-agent/Wacli CI workflows, new focused tests. | Medium: false-green CI is currently possible for newly added P0 modules. |

### Canonical state contracts

Only two monotonic epochs are added to canonical conversation state:

- `ownershipVersion`: already established and advanced only by Communication Conversation Authority ownership/sender-control transitions.
- `customerInputVersion`: advanced only once for each newly committed unique inbound customer message at canonical ingress.

Every autonomous Maya turn captures both values. Equality, not merely current `ai_active` state, determines freshness. This specifically prevents the unsafe sequence `Maya starts -> human takes over -> human returns conversation to Maya -> old Maya work resumes` because the ownership epoch changed even though the final disposition is again AI-active.

A voice transcript never advances `customerInputVersion`. It enriches the original canonical message. If a text message arrived after the voice note, its higher input version makes a late transcript stale for action while preserving the transcript for operators/audit.

### Deferred processing contract

`maya.debounceMs` remains policy/configuration, with the V1.1 target default of `12000`. The persistent queue stores `eligibleAt`, expected epochs, account/conversation identity, and source message identity. The delayed task is only a wake-up. It must not carry mutable customer intent, ownership, price, appointment state, or any other authority data.

When a wake-up runs it must:

1. acquire the existing conversation lease;
2. read the latest canonical pending input/eligibility;
3. no-op if a newer input moved `eligibleAt` forward;
4. derive the one canonical current turn;
5. verify account + ownership + customer-input epochs;
6. run Observer and governed Case/dispatch processing;
7. evaluate Reply Policy;
8. invoke the single Customer Runtime only if reply permission allows it;
9. revalidate epochs before each business tool and customer-facing outbound commit.

No blocking sleep is permitted.

### Testing design

The implementation phase must place evidence at the boundary where the failure can occur:

- pure/unit: communication account/header decision, canonical conversation/message IDs, current-turn content selection, account-scoped session ID, party resolution, ownership/input epoch decision, outbound-class claim policy, deterministic Case replay/freshness, dispatch mutation builders;
- Firestore transaction/integration: duplicate inbound x3 -> one canonical message/input version; same remote number on two accounts -> distinct conversation/message/session/case identities; takeover and takeover-return during debounce/model/tool/final queue; stale voice transcript after newer text; Case + hold/release atomicity; Booking cancel/reschedule + hold convergence;
- transport integration: bridge Bearer + communication-account binding on webhook/media/poll/ack; poll never claims another account; Maya conversational command rejected on stale epoch; human conversational command rejected after ownership loss; transactional appointment/van notification remains sendable without conversation ownership;
- voice integration: new eligible audio -> stored media -> one transcript -> same canonical input/turn; historical/replayed old audio -> zero automatic transcription/action; duplicate audio webhook -> one transcript/turn;
- regression: linked-device `FromMe` outbound protection, technician transcription, technician schedule, Booking availability/commit-time revalidation, unknown-price behavior, ERP Communication Center ownership/send actions;
- quality gates: add all new P0 files/tests to `validate:firebase` and focused suites; run ERP Next typecheck/build where the Communication Center is touched; syntax/contract-check the deployed DigitalOcean bridge source on pull requests.

The specification's 30 named P0 scenarios remain the final required scenario set. The implementation must not collapse them into one mocked unit suite.

### Migration and recovery design

No production migration is authorized by this design phase.

Before account-scoped IDs can be activated, implementation must provide a dry-run planner that can report legacy conversation/message/session/outbound mappings and conflicts without mutating production. The activation path is **copy + retire**, not destructive delete:

1. identify legacy conversation records that belong to the deliberately approved account;
2. calculate canonical account-scoped IDs;
3. stop on collisions/ambiguous account provenance rather than guessing;
4. copy required ownership/status/customer/recent operational state to canonical projection;
5. mark the legacy conversation projection superseded/read-only for a bounded compatibility period;
6. activate canonical writers only after counts/conflicts are verified;
7. preserve raw historical messages and audio; do not backfill historical transcription;
8. migrate only provably attributable active Maya sessions/offers;
9. drain or explicitly map already-queued conversational outbound items before a sender cutover; do not infer a queue item's account from its recipient phone.

The existing `cutoverWacliProductionAccount.js` performed a different historic inbox cutover and includes destructive live-projection reset behavior. It is not the migration implementation for this architecture and must not be repurposed as a patch.

Recovery rules:

- if dry-run identifies an ambiguity/conflict, abort before canonical-writer activation and keep legacy projection untouched;
- inbound/provider replay remains safe because canonical IDs are deterministic;
- a failed delayed wake-up leaves `customerAgentInboundQueue` as recoverable truth and can be retried without recreating intent from model memory;
- a failed send leaves the one outbound queue/audit state intact; it is never reconstructed from chat text.

### Rollback design

Rollback is intentionally asymmetric because reverting code after an identity cutover must not reintroduce split-brain identity.

- Before production identity activation: ordinary code rollback is allowed after verification.
- After canonical IDs are activated: do **not** revert writers to raw `chat` document IDs. Disable Maya capabilities through existing policy/feature flags while preserving canonical communication identity.
- If delayed task execution is unhealthy: disable Maya reply/action activation; keep queue records and Observer-safe/manual workflows available. Do not add a second polling work store as a hotfix.
- If outbound epoch validation blocks valid traffic: pause the affected conversational sender class and diagnose the canonical queue/ownership data. Do not bypass the guard globally; transactional notification class remains independently governed.
- If a Case/Dispatch Safety defect is suspected: disabling Maya does not silently clear an active hold. Holds are resolved only through governed Dispatch Safety/Booking transitions or explicit authorized human intervention.
- If bridge/account binding fails: stop/pause the affected account transport, correct the verified deployment binding, and replay its durable outbox/ACK records. Do not accept an unknown/mismatched account to restore traffic.

Any production rollback that changes deployment/configuration still requires explicit human approval.

### Implementation dependency order

The smallest safe build sequence after this architecture-design phase is:

1. canonical bridge/account binding + canonical ingress message/conversation IDs;
2. replay-safe `customerInputVersion` assignment at ingress;
3. one shared current-turn derivation for text + voice transcript;
4. account-scoped Maya session identity and new/existing party resolution;
5. deferred `eligibleAt` queue + wake-up transport;
6. exact ownership/input epoch guards through model/tools/outbound commit;
7. account/epoch-aware outbound envelope and claim validation while preserving transactional traffic;
8. stale-safe Observer/Case + atomic Dispatch Safety;
9. Booking lifecycle hold convergence;
10. named integration/regression suite and dependency-aware quality gates;
11. four review passes plus independent Reviewer evidence.

Do not skip an earlier identity/epoch dependency by compensating with a later guard.
