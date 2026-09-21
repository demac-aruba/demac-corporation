# Review: standalone Project budget acknowledgement

## Review mode and scope

Solo Maintainer Adversarial Review; Codex implemented and then separately reviewed this
change. This is not an independent review. Scope: PR #515 based on deployed `cb01c469`,
including its existing calculator and the clarification in owner comment 5765420349.
Authorities: Booking Authority owns live availability, identity, permissions, locks and
idempotency. Browser Projects owns only its existing non-canonical preview record.
Rule: OPS-PROJECT-BUDGET-001. No new ledger, backend service or central migration.

## Findings and corrections

| Finding | Correction / evidence |
| --- | --- |
| Original #515 had only a passive warning | A native modal now requires the authorized operator's explicit continue/cancel choice, for both confirm and hold. |
| Consent could refer to an older selection | Decision identity includes actor, Project/phase, forecast, offer/version, selected option and request signature. Changing any of them retires the open decision. |
| A lost response discarded the offer and could obtain a replacement | Ambiguous outcomes freeze the drawer and replay the original closure/request. Typed definite rejections still permit correction/revalidation. A synchronous in-flight guard excludes overlapping submissions. |
| Only the first Work Order was locally linked | New primary/support allocations use the existing idempotent per-Work-Order links; each allocation is counted once. Original total workload is not added again to its split. |
| Actor could change while a response/link was pending | Retry and local mutation authorization recheck the original actor as well as current Projects permission. Booking Authority still authorizes every canonical request. |
| Production does not equal main | Vercel resolves the live domain to cb01c469. Main 6d501d80 contains merge-only overtime. A normal main publication includes that UI, while #515 frontend paths do not trigger its Functions deployment. |

## Verification

- 21 budget scenarios, including 66/63/6, exact boundary, 66/70, support split,
  exact replay, preserved baseline/actuals and original records, invalid identity and slots.
- Existing phase acceptance and live Scheduling acceptance passed.
- 26 browser scenarios: 13 each in Chromium and WebKit, real React drawer, synthetic
  authority responses, no external requests. Includes cancel, hold, selection change,
  concurrent forecast change, support, ordinary operator capabilities, read-only denial,
  availability/final-commit conflict and lost confirm/hold responses. Mobile modal reviewed.
- 11 transport scenarios exercise the actual Office API adapter with synthetic fetch/session:
  definite 4xx, unknown 408/5xx, malformed success, and exact confirm/hold retries after loss.
- 82 existing Booking Authority, Firestore transaction, work-order, capacity, scheduling,
  multi-work and communication tests passed. Their storage is synthetic, not production.
- ERP typecheck and normal `npm run build` passed, including its required prebuild suites.
  The first build exposed an out-of-root dependency junction; real local dependencies fixed
  the environment and the unchanged normal build passed. No check was disabled.
- No Functions/rules/deployment configuration changed. No real customer/appointment was
  created or edited by this verification. Code rollback is the previous live Vercel artifact.

## Remaining operational limits and release decision

Candidate suitable for preview and current-main compatibility checks, not a production
approval. Keep #515 separate from #514; neither Expenses nor QBO nor central migration is
needed for this correction. CI and preview results must refer to the new candidate head.

The narrow publication route is this production-base branch with verified production
build settings and an explicit controlled domain promotion. Do not assume that an existing
preview can simply be promoted with equivalent configuration. Connected Vercel get-project
currently fails tool input validation; domain deployment inspection works, but live project
configuration has not been independently verified. Do not silently deploy current main.

The Firestore export supplied by the owner is SUCCESSFUL. The previously required restore
rehearsal and a private snapshot of the actual browser Projects data remain unverified.
The export does not cover localStorage. Photos and a future daily backup protocol were
explicitly deferred and are not prerequisites. Do not restore the old database over newer
appointments merely to undo this frontend change.

The in-memory recovery applies while this drawer remains mounted. Browser crash/reload
recovery is not a durable journal; reconcile the canonical agenda before creating any
replacement after such an interruption. Historical/independently added support and Field
actuals are not retroactively reconciled by this fix. Those limits must not be represented
as completed central Projects behavior.

Release remains pending verified recovery evidence, deployment pairing/configuration and
the applicable production authorization. None is waived by local or CI test success.
