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
