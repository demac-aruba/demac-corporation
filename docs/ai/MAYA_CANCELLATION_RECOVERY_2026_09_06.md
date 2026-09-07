# Task and review: Maya explicit cancellation recovery — 2026-09-06

## Task context

- Owner/source: Christian authorized continuing construction on 2026-09-06 after reviewing Maya V1.1 and specifying real explicit cancellation, capacity reuse, cancellation history, waitlists, earlier-date offers, new-contact handling and new voice-note understanding.
- Mode: **Deep Review / Solo Maintainer Adversarial Review**. This changes authorization and transactional scheduling behavior, not merely presentation.
- Branch: `feature/maya-cancellation-recovery-20260906`.
- Pull request: #486, intentionally draft and based on `feature/maya-cancellation-reschedule-pilot-v1-1` (#440), not main.
- Starting revision: `daa26364eed7a68e6da9b5016d51bf2232ee5fac`.
- Last functional source/test revision before documentation: `c88810cb2cf89b8f01d59929fc6242bd1ff9aa3c`.
- Dependencies #436 and #440 remain separate unmerged work. This child does not resolve #436's divergence from current main.

## Scope

This delivery implements the first backend slice: an explicitly identified, policy-authorized customer cancellation can progress from P0's protective dispatch hold through canonical cancellation and release its verified capacity.

Changed behavior owners:

- `functions/demacCommunicationCaseService.js`: do not ignore conflicting or unresolved structured cancellation dates/times when there is a single candidate.
- `functions/demacCustomerAppointmentMutationGuard.js`: actual Case/appointment verification, strict current phone authorization, linked-record checks, required execution proof and atomic existing-Case resolution.
- `functions/demacCustomerAppointmentLifecycleTools.js`: an empty customer reason is allowed; use an internal audit category, not a fabricated explanation.
- Existing guard and lifecycle test files: preserve original tests and add focused negatives and real-domain composition.

Out of scope for this slice: main integration, provider deployment, production configuration, actual customer messages, real appointment changes, cancellation-list UI, waitlist persistence/UX, recent-conversation preference extraction, proactive offers and acceptance, complete reschedule recovery, and live new-contact/voice acceptance.

## Governance and source of truth

The reviewed root `AGENTS.md`, `AUTHORITY_MATRIX.md`, `BUSINESS_RULES.md`, `QUALITY_GATES.md` and task/review templates govern this work. Communication rules and current-turn/ownership invariants from the P0 `COMMS-*` contract remain relevant.

- Booking Authority remains the sole appointment/Work Order/capacity lifecycle authority.
- Communication Authority remains the sender/ownership authority.
- CRM customer/property identities are preserved.
- The existing Communication Case is workflow state and is resolved in the same successful transaction; it is not another schedule or cancellation ledger.
- The existing mutation receipt collection is proof of execution only. No new source of truth, collection, runtime or queue is introduced.
- No Firestore rules, authentication policies, credentials, environment variables or deployment workflows were modified.
- No Legacy code was removed or copied; office/manual lifecycle behavior was not rewritten.

## Acceptance criteria for this slice

- [x] The actual P0 Case service can detect a clear request, protect dispatch and produce the previously blocking pending state; the guarded customer tool can then complete the canonical cancellation.
- [x] A missing customer reason does not block cancellation or generate an invented explanation.
- [x] Appointment, linked Work Orders, dispatch hold, capacity locks, receipt and Case resolution are atomic.
- [x] A hold without a successful cancellation does not free capacity.
- [x] The transaction rechecks current reply permission and selected phone allowlist, not just the mutation flag or an old inbound decision.
- [x] The actual Case matches current account/conversation/message/customer/appointment/type/state and sufficient confidence.
- [x] A contradictory explicit cancellation date/time is not ignored even when there is only one candidate.
- [x] Wrong, missing, foreign or changed linked records prevent cancellation; referenced foreign capacity is not released.
- [x] Unknown or changed Work Order execution status requires review. The accepted canonical future-work status is `Confirmada`.
- [x] Human takeover, takeover-return, newer customer input, ambiguous appointment, missing Case and changed source evidence deny the operation.
- [x] Deterministic retries do not create a second cancellation, duplicate history or another capacity release.
- [x] Missing, altered or wrong-target execution proof cannot resolve the Case or commit partial changes.
- [x] The pending-state exception is limited to cancellation, not an unaccepted reschedule.
- [ ] Emulator and live provider/model end-to-end acceptance: not executed.
- [ ] Whole Maya V1.1 product acceptance: not completed by this slice.

## Verification evidence

Verification ran in GitHub Actions against PR test merges into #440, **not against production main**. No local authenticated clone was available; no local emulator run is claimed.

Initial source/test revision `ec1df89d4e4876ead399d48e38c23423c7c5c41d`:

- Customer Agent Architecture run `34074660883`: SUCCESS. Log inspected for job `101598316765`.
- Customer Agent Production validation run `34074660843`: SUCCESS.
- TypeScript and web build run `34074660831`: SUCCESS.
- Architecture logs showed 287 Customer Agent tests and 113 Booking Authority tests passing with zero failures/skips in those suites, plus Office Booking Authority, commercial, reservation, formatting and router checks.

The separate adversarial pass then produced further source/test corrections at `91793f0`, `c3ce5b7` and `c88810c`, including eight additional composition tests. On `c88810cb2cf89b8f01d59929fc6242bd1ff9aa3c`:

- Customer Agent Architecture run `34075217906`: observed SUCCESS.
- Customer Agent Production validation run `34075217899`: observed SUCCESS.
- TypeScript/web run `34075217910`: final result and exact documentation-tip checks are recorded in PR #486; do not mistake earlier green checks for a different revision's result.

The two changed test files now contain 44 focused tests: 24 guard tests and 20 lifecycle/tool/composition tests, preserving 17 pre-existing tests and adding 27. Some individual tests exercise several denial variants.

The composition harness calls the actual Case service, customer lifecycle tools, mutation guard, Booking Authority cancellation, dispatch safety and capacity-blocking predicate. Persistence is an in-memory transactional double that enforces read-before-write ordering and atomic rollback. Observer classification is a controlled parsed-output fixture. These tests do **not** demonstrate live language accuracy, WhatsApp transport, Firestore emulator concurrency or real deployment behavior.

## Separate Solo Maintainer Adversarial Review

- Reviewer/agent: ChatGPT, separate review pass after the first implementation and green CI.
- Implementation author/agent: ChatGPT.
- This is **not an independent review**.
- Reviewed owners and integrations: PR source/test diff; Case producer; guard consumer; customer lifecycle tool; canonical cancellation/dispatch lifecycle; canonical Work Order initialization; scheduling provider capacity links; runtime lifecycle proof/instructions; relevant CI workflow.

### Findings and disposition

| Severity | Finding | Disposition |
| --- | --- | --- |
| High | P0 held cancellation was unreachable from an `APPOINTMENT_MATCHED`-only guard. | Corrected with a cancellation-only, actual-evidence-qualified exception; pending reschedules still denied. |
| High | Conversation projection alone was insufficient authorization evidence. | Actual Case and appointment re-read inside transaction; source/account/customer/target/state mismatch tests added. |
| High | Removing a test phone after observation did not independently revoke mutation authority. | Current reply policy and exact allowlist rechecked in transaction, including pilot exception denial. |
| High | A single candidate could override an explicit contradictory cancellation date/time. | Cancellation correlation now validates the supplied structured values first; clarification/no-hold/no-cancel tests added. |
| High | Referenced capacity/Work Orders could have changed ownership or execution state. | Cancellation wrapper validates all referenced records before canonical writes; foreign-lock and altered/missing-record tests added. |
| Medium | The initial completion check could be bypassed by omitting the optional receipt argument. | Valid deterministic receipt is now required, bound to the context/action/target; missing/tampered receipt tests added. |
| Medium | Successful cancellation could leave the Case unresolved, and resolving it could disrupt retry authorization. | Resolve existing Case atomically; check committed receipt before mutable Case state; post-resolution replay test added. |
| Medium | Canonical cancellation required a nonempty reason even when the customer gave none. | Tool supplies an internal audit category; preserved empty customer explanation and canonical lifecycle proof. |

### Decision and residual risk

**Pass with recorded follow-up for continued isolated-branch development of this bounded backend slice. Blocked for production merge/activation and for claiming the complete Maya module is finished.** No known required failing check is waived or deleted. Exact final-tip CI status must be checked on the PR before any further approval decision.

Remaining engineering owner: the maintainer continuing Maya, not the business owner acting as a code reviewer. Required before live activation rather than an invented calendar deadline:

1. Reconcile #436/#440/recovery with the current main code and run affected integration/release gates again.
2. Verify account, deployed functions, settings, actual test-phone list, queue health, Communication Authority and security-rule/client parity.
3. Reconcile the broader observation/dispatch-hold, transcription and outbound pilot scope with the selected-phone-only testing boundary. This slice's strict allowlist applies to irreversible lifecycle mutations; it does not silently change every P0 observer/voice path.
4. Exercise actual model conversations, including relative dates, cancellation versus reschedule, ambiguous references, no supplied reason, operator takeover and changed scheduling state between understanding and commit. Tool metadata removes the reason requirement, but live linguistic behavior is not demonstrated by the deterministic tests.
5. Run emulator/provider-backed concurrency and delivery acceptance. Confirm pending transactional reminders cannot incorrectly be delivered after cancellation; this slice did not rewrite reminder transport.
6. Define the full accepted-reschedule/earlier-offer state transition. A pending reschedule remains intentionally blocked, not falsely declared fixed.
7. Obtain explicit deployment/configuration approval. No autonomy flag, provider, voice cutoff or production access was activated during this task.

## Remaining product construction, not a request to repeat requirements

- Cancellation list and Maya activity surfaces projecting canonical records; no parallel cancellation database.
- Waiting-without-booking and booked-but-wants-earlier preferences, backed by original conversation evidence and updated when the customer withdraws interest.
- Bounded review of recent text conversations to recover those preferences; no historical-audio backfill.
- Canonical compatibility checks for address/sector/route/van/personnel/service/duration, followed by controlled proactive offers.
- Customer acceptance/rejection/expiry and atomic new booking or reschedule; preserve the original appointment until replacement is successfully secured.
- Operator-visible voice/transcript and new-contact booking acceptance.
- Configurable offer validity, permitted outreach hours, candidate priority and preference expiry; proposals are not treated as already approved production settings.

No real customer data, appointments, capacity, messages or demo records were created or modified by this development task.
