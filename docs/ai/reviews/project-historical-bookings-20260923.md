# Review: shared Project planning and historical slot corrections

Review mode: **Solo Maintainer Adversarial Review**, separate from implementation; not an independent review. Reviewer and implementation author: Codex. Reviewed functional source: `12794dfbf48329de6eaa6814d00ec8b1a1f53e29`; current-main integration: `8f3d4ca5ce1789fb36c148bc77035c8c9b52c3f6`.

## Scope and authorities

Read the complete change, the Project portfolio/drawer/label callers, Booking Authority replay/transaction paths, existing cancellation, Work Order projection, role normalization, default-deny Firestore rules and affected deployment triggers. CRM identity, Booking capacity, Field execution, Payroll attendance and financial actuals retain their existing authorities. Shared Project planning and immutable links are the explicitly owner-authorized new authority. OPS-SCHED/OPS-TEAM and silent historical registration remain protected.

## Findings and resolution

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | A browser Project link could fail after a canonical booking committed. | Shared confirm/hold and historical replacement now append the Project link and unique claim in the same Booking Authority transaction. Unpublished legacy records remain explicitly local. |
| High | Current crew settings cannot establish who occupied an old booking. | Historical replacement requires a cancelled canonical source, matching Work Order/crew and original capacity-lock snapshot. It uses only a subset of that original allocation and rejects missing evidence. |
| High | Cached offers and idempotent replies could outlive Projects permission. | Fresh profile authorization precedes shared availability cache/replay; mutations recheck the user inside the transaction. Historical API reauthorizes every call. |
| High | Four bootstrap/package-triggered pipelines could deploy unrelated current-main changes during a merge-only integration. | Wacli, Workforce, Task Tracker and Marketing deployment jobs now honor the existing merge-only convention. Their validation jobs are unchanged. The scoped release compares currently deployed Office sources before updating Office and creating Project Authority. |
| Medium | An effect could discard a newly opened budget decision after a slot change. | Retire only decisions with an obsolete signature. All 26 existing Chromium/WebKit budget cases passed afterward. |
| Medium | Shared planning could otherwise import execution/cost/checklist actuals or lose history. | Server validates CRM and canonical links, keeps existing links/actuals immutable, rejects imported actuals and completed checklist changes, bounds records, and requires a matching version. |

## Verification evidence

- Ten real isolated Firestore cases: explicit dry-run import, cross-session persistence, canonical cancellation of six followed by two, preserved original/audit/crew, fresh roles, foreign links, stale versions, source ambiguity, transaction races, lock and technician conflicts, confirmed/temporary atomic links, and default-deny direct writes.
- Real React/HTTP/Project API/Firestore flow in Chromium desktop and WebKit mobile: publish, preview, save, reload, second browser with empty local storage, live slot total and crew detail. Lost-response-after-commit recovery passed without duplication.
- Existing regression: 158 Booking Authority cases, 51 Office API cases, 26 budget browser cases, four slot-progress browser cases and 90-second desktop/mobile Scheduling refresh observations (900 samples each).
- ERP typecheck and production build passed. Project preview, current slot transport/calculation and live Scheduling acceptance passed. Slot batching remains bounded; 13 linked Work Orders use one batch.
- Synthetic screenshots inspected; mobile correction review fits the viewport. No production business records were used or changed by tests.
- GitHub validation for the final PR head and the scoped release remains a required publication gate. Green local tests do not waive CI.

## Decision and residual limits

Local adversarial review passed after the corrections above; merge/deployment remain conditional on successful final CI. Prior explicit owner approval covers the accepted historical/shared-planning work and merge/deploy after tests and conflict resolution.

Historical creation in this release covers the requested **cancelled single-Van booking -> smaller replacement**. It does not infer a crew for an unrelated historical booking or perform a multi-Van historical correction. Missing evidence blocks the write. Browser Projects require explicit reviewed publication; imports are never automatic. Legacy phase-hour snapshots remain advisory (AD-014); the requested slot progress and details read current canonical Work Orders. Field, physical completion, payroll and financial actuals are not introduced by this change. Current record limits are 200 shared Projects, 100 phases and 150 booking links per Project; increasing them requires pagination/subcollections. No production data migration is part of deployment.
