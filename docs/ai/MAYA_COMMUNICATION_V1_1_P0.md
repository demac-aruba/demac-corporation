# Maya AI Agent & Communication Center Engineering Specification V1.1 — P0 implementation record

Status: active implementation branch; not production-activated.
Base audited: `main` at `ac59100c36c2af2fd188d423d6264fff98df1d12` (2026-08-24).

## Objective

Evolve the existing Customer Agent and Communication Center architecture without creating a second Maya runtime, second Booking Authority, second WhatsApp queue, or parallel pricing/cancellation authority.

The P0 invariant is:

`Communication ingress -> canonical message/conversation -> Observer/Reply policy -> one Customer Runtime -> governed domain tools`

Observation, reply permission, sender ownership, and business-action authority are separate decisions.

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
