# Task: Connect cancelled openings to sequential, governed earlier-appointment offers

## Request and authority
Christian authorized continued development, not merge or production activation. Parent: PR #495 at d0a1599830b985c66b7cb547206c504ad5336431. Work only on feature/maya-cancellation-orchestration-20260909, draft PR #498. No production reads/data/configuration/security/secret changes, real messages, operational demo records, main/parent merge or deployment were performed.

## Scope and acceptance
Connect a new canonical cancellation to bounded selected-phone conversation review, existing waitlist compatibility, configured candidate priority, existing offer preparation and existing WhatsApp queue. Continue with another eligible candidate after explicit decline or proven expiry. A pending offer waits; acceptance stops the opening's sequence. Current availability, full workload, routes, account, ownership and phone restrictions remain mandatory. Preparing or sending an offer never moves the original appointment.

Automation is separately default-closed. An activation cutoff and explicit ranking/scan/contact policies are required, never silently defaulted from test fixtures. Only canonical normalized selected-phone conversations are discovered. A bounded scan overflow or ambiguous source requires review, not a claim of complete coverage. This slice targets earlier appointments with verified workload; unbooked customers remain outside automated allocation until their workload/booking path is complete.

## Implemented design
Booking Authority and Communication Authority remain the only domain writers and sender/queue authorities. Existing cancelled Appointment records hold derived bounded orchestration metadata: generation, lease, policy fingerprint, offer history and outcome. This does not replace their status or create another schedule/capacity model. Existing bookingOffers remain offer records; original WhatsApp messages remain evidence.

Two Firestore event handlers and one Cloud Tasks handler are wake-up transport only. Payloads contain only a canonical cancellation reference and generation, not phone, customer text, scheduling choices or model instructions. Every operation rereads canonical data. New handlers are source code for a later explicitly approved rollout, not deployed functions. No second WhatsApp queue, model, Customer Runtime or public callable is introduced.

- `startMayaRecoveryAfterCancellation` detects a new canonical cancellation generation. Changes to orchestration metadata alone do not retrigger it.
- `continueMayaRecoveryAfterOffer` wakes the same opening after a changed accepted/declined offer result. Event data does not itself authorize another offer.
- `processMayaRecoveryOpening` executes the bounded coordinator with an explicit lease and current policy checks. Tasks are not domain truth.

Lease fencing and policy/generation checks happen inside every delegated transaction. Offer preparation and its orchestration receipt commit together. A lost prepare result or task-enqueue response resumes the same recorded offer rather than creating another version. Model and task-transport calls happen outside domain transactions.

The existing outbound enqueue/claim rechecks automation state and policy. Automated origin is included in the immutable offer fingerprint; fingerprints of old/manual offers without that field retain their existing representation. Removing both origin and orchestration metadata cannot make the stored offer proof valid as a manual offer.

Already-sent queue items require exact canonical delivery proof before the coordinator proceeds. An absent queue after publication, uncertain processing attempt, changed claimed payload or inconsistent result stops for review. Canonical accepted results are checked against appointment, source completion pointer, fulfilled preference, Work Orders and capacity before marking the opening complete. A retry after acceptance-history recording but before finalization closes that result rather than restarting outreach.

## Explicit test-pilot bounds and configuration
`recoveryAutomationEnabled` must be true, along with existing reply, interest/history, offer, outreach, routing, confirmation and reschedule controls. No such production values were set.

`recoveryAutomationPolicy` requires version, activeSince, ranking, maxConversations, maxCases and maxOffers. The only implemented ranking option is `oldest_verified_request`, using the verified source timestamp and a stable case-ID tie-break. Supporting that option is not owner approval to activate it. Contact windows/cooldown remain in the existing explicit Aruba contact policy.

The isolated implementation permits at most five selected-phone conversations, fifty examined preference cases and ten recorded offer generations, all with explicit configured limits. Each opening contacts a conversation at most once in that sequence. Duplicate canonical chats for one selected phone require review. Discovery is not an unrestricted archive scan. Phone matching uses the canonical normalized phone field; alternate identity/materialization parity still requires live validation.

Out-of-hours processing schedules the next configured Aruba contact window without preparing an offer or consuming model work. No configured window before the opening means no contact. A no-candidate/exhausted/review-required state does not automatically restart forever when unrelated new messages arrive; broader continuous waitlist monitoring and operator reconciliation remain follow-up work.

## Authorities and protected rules
Communication Authority owns account identity, source messages, selected-phone reply permission, ownership epochs, the existing outbound queue and transport proof. Booking Authority owns current compatibility, capacity and lifecycle writes. The coordinator writes only derived orchestration state and uses those authorities for history, offer and scheduling operations.

COMMS current-turn/context/one-confirmation/no-invention, OPS-ROUTE, OPS-TEAM and OPS-SVC protections remain. No price, service duration or unbooked workload is invented. Original booked appointments stay intact until the canonical acceptance succeeds. Rejecting one offered time preserves the customer's general WAITING preference.

## Exact automated source/test verification
Source/test revision: **6029cef15e03f253dcf12a620db09652d9bb356b**.

Seven triggered PR workflows SUCCESS on that revision:
1. Customer Agent Architecture: 34361616056.
2. Customer Agent Production validation: 34361615974.
3. WhatsApp wacli Connector: 34361616072.
4. Transactional WhatsApp validation: 34361616073.
5. Office Booking Authority: 34361616048.
6. Marketing Agent Function validation: 34361616112.
7. TypeScript and web build validation: 34361616156.

Architecture job 102499748954 was explicitly inspected. Syntax, focused operations/waiting/history/recovery tests and retained Booking Authority, Office, commercial, product reservation, WhatsApp formatting, Customer Agent and single-runtime/router checks all succeeded. No required assertions, tests or quality gates were weakened, disabled, deleted or waived. No additional ERP Next CI workflow is claimed for this slice.

Three new required suites execute through the retained `mayaRecovery*.test.js` command: `mayaRecoveryCoordinator.test.js`, `mayaRecoveryAutomationIntegration.test.js`, and `mayaRecoveryAutomationReview.test.js`. A new synthetic fixture composes real history recovery, matching, offer services and the canonical Scheduling Provider.

Source-revision jobs explicitly inspected: deploy-customer-agent-production, deploy-wacli-connector, deploy-transactional-whatsapp and deploy-office-booking-authority were SKIPPED. Workflow labels containing Production describe validations here, not production releases.

This delivery documentation change will trigger its own checks. Source verification above must not be misrepresented as a finished check on a later commit. The PR description records the exact final delivery revision and its actually observed checks.

## Composed acceptance evidence
- Actual cancellation event handler -> bounded coordinator -> real historical preference recovery -> real route/workload/capacity matching -> existing offer producer -> existing queue -> actual Wacli claim/exported HTTP ACK -> canonical accepted earlier move -> completion of the opening sequence.
- Two compatible customers with equal request times follow the stable priority tie-break; tests verify the chosen customer's appointment/capacity and preservation of the other customer, not fixture array order.
- Actual delivered rejection -> changed offer event -> next compatible customer, keeping the first customer's appointment and WAITING preference intact.
- Explicit Thursday-to-Tuesday single-candidate path plus injected finalization failure -> safe retry without another message, model selection or appointment move.
- Expiry, configured limits, historical cutoff, selected-phone isolation, duplicate/out-of-order events, stale worker, policy revocation, missing/forged proof, reoccupied capacity and transaction rollback.
- Lost preparation result and failure scheduling the next task resume the same recorded offer/queue item. Already uncertain delivery is not blindly retransmitted.

Tests use actual domain/event/runtime-adapter/queue/HTTP-handler code with synthetic in-memory persistence, scripted semantic results, fake authenticated HTTP requests and controlled clocks. They do not prove live semantic interpretation, physical WhatsApp delivery, real phone/account materialization, Firebase emulator/index/security, distributed contention, browser/mobile behavior or broad-scale latency/cost. Local GitHub DNS resolution was unavailable; no local full-repository clone/test or emulator result is claimed.

## Separate Solo Maintainer Adversarial Review
Mode: **Solo Maintainer Adversarial Review, not independent review**. Re-read the owner constraints and authority/rule/gate contracts; inspected the full changed surface and owning/affected callers, including bootstrap exports, offer preparation and fingerprints, existing outbound claim, historical recovery, canonical lifecycle and completion recovery. Challenged duplicated events, policy revocation, source edits, queue proof, partial success, lease fencing and reference ownership.

Findings and corrections:
1. High: returning a continuation promise without awaiting it inside the coordinator try/catch let a follow-up task failure escape without releasing the lease. Added awaits and retained the original failed-retry assertion; it passes.
2. High: automated origin initially was not part of immutable offer material. Bound it conditionally into the fingerprint and recomputed it at preparation; tests remove offer metadata, cancellation metadata and both, verifying actual claim denial. Existing manual fingerprints remain compatible.
3. High: an accepted history update followed by failed finalization could restart discovery on retry. Accepted-state handling now resumes canonical completion regardless of whether its history entry already closed. Fault-injection regression passes.
4. High: a sent status alone was insufficient for expired-offer continuation. Reuse exact queue identity and deliveryProof; lost/unproven delivery stops without issuing another offer. Accepted completion also checks canonical domain/source/fulfillment proof.
5. Test issue: two newly added multi-customer integration assertions assumed the first fixture customer wins a timestamp tie. Replaced that assumption with stronger whole-appointment and capacity ownership assertions for the actually selected customer, preserving the intended coverage. No existing required tests were removed or weakened.

Disposition: the bounded offline implementation and its automated gates pass; continued isolated integration is appropriate. Full-product merge/release remains blocked by the unfinished scope and validation below, not merely by the absence of an external reviewer.

## Residual risk and remaining release gates
- Reconcile the full parent stack with current main and run integrated regression checks; no merge is authorized yet.
- Verify Firestore indexes, transaction/contention behavior, rules, task invocation permissions and exact deployment inventory in a non-production test environment. Newly exported event/task handlers need explicit rollout approval and least-privilege invocation configuration.
- Test real selected phones, account and remote-identity normalization, provider clock/ACK ordering, model interpretation and new-contact/voice flows in an authorized pilot.
- Complete operator-safe uncertain-send reconciliation, arbitrary clarification completion, late-ACK automatic wake-up and pending-offer changes. The current coordinator stops conservatively on uncertain outcomes.
- Complete unbooked-customer workloads/new bookings, reminder updates, fulfilled waitlist/status presentation, full bounded offer history UI, richer subwindow placement and Papiamento offer/confirmation rendering. The current automation handles verified earlier-appointment candidates only.
- Current preparation/claim checks protect the database-to-bridge boundary, not an exactly-once or physically atomic WhatsApp send. State may change after the bridge has claimed a command. Original appointments/capacity remain governed by canonical commit checks.
- Jobs stop once the opening has elapsed; cleanup/reconciliation of an unfinished orchestration record after that point is not an implied new booking action or a completed universal recovery worker.
- Approve actual contact/ranking/activation policy, merge and any production rollout separately. Test fixtures are never production settings.

Rollback before deployment is source-only: keep this draft unmerged. After any later authorized deployment, disabling automation blocks new discovery and automated offer claims without undoing appointments already committed; pending/uncertain sends require reconciliation, not arbitrary deletion or resend.

Primary contracts consulted: https://firebase.google.com/docs/functions/task-functions ; https://firebase.google.com/docs/functions/firestore-events ; https://firebase.google.com/docs/firestore/manage-data/transactions . Events may repeat/reorder and transaction callbacks may retry. No model or task enqueue executes inside a domain transaction.
