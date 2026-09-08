# Review: Careers architecture audit and root-cause repairs

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer / agent: ChatGPT, fresh adversarial pass after implementation commit 886db8619895f3bdb6eda6b1bbaf5477c0709e44 and against final runtime commit 6d0608ba9f1370d93ef3710bf86901611c1453d8.
Implementation author / agent: the same maintainer. This is not independent review.
Date: 2026-09-08.

## Scope reviewed

- Request: Christian requested an architecture audit, professional root-cause fixes rather than accumulated patches, and use of the repository engineering protocol.
- Task: `../tasks/CAREERS_ARCHITECTURE_AUDIT_20260908.md`.
- Decision: `../decisions/ADR-CAREERS-001-contract-and-ownership.md`.
- Audit baseline: c3b2146c0175069394946099e5242b3a216af82d. Final tested runtime: 6d0608ba9f1370d93ef3710bf86901611c1453d8. Documentation checkpoint may be a later commit without runtime changes.
- Working branch: feature/careers-funnel-preview; PR #494. Main remains outside the audit's writes.
- Callers: CareersPublic and design preview, ApplicationFunnel, RecruitmentWorkspace, API adapters, functions/careers service/HTTP/file/worker boundaries, current Auth and client rules.
- Authority rules: CAREERS-FORM-001, CAREERS-FILES-001, CAREERS-UI-001, CAREERS-RELEASE-001. Existing Firebase Auth/users and the already-implemented Careers collections remain authoritative. No parallel customer, employee, scheduling or communication domain was created.
- Production deployment/activation, credential/configuration changes, real personal data and native-device certification were outside the actions performed.

## Baseline correction

The old PR body and the previous conversational readiness report were stale. At c3b2146 the branch already had a persistent server-backed recruitment service, protected files and an administrative workspace. Earlier Next router-state repairs had passed their subsequent tests. The audit therefore did not rebuild another backend or replace the working navigation implementation. It verified these existing boundaries and isolated current defects.

## Findings and disposition

| Severity | Location | Reproduction / evidence and impact | Correction / outcome |
| --- | --- | --- | --- |
| Critical | functions/careers/service.js upload catch | A Firestore finalization transaction could commit a clean file but lose its acknowledgement. The old catch queued deletion and rejected the reservation even though the file was owned. New fault-injection test failed on baseline. | Resolve session and submitted-application ownership in a transaction before cleanup. Return the committed clean record on retry; never enqueue application-owned bytes. Real emulator tests cover both active session and application adoption after session removal. PASS. |
| High | core.js vs lib/careers-preview.ts | Browser and server used separate candidate validators. Browser had six question kinds while server accepted eight; dates/URLs and answer shapes could fail only after the candidate completed the UI. Hidden conditional ancestors were not handled consistently. | One portable form-contract.js plus typed declaration, used on both sides. Actual date/URL controls and admin options; consistent limits, country codes, choice shapes and conditional ancestry. Eighteen cross-layer/recovery/style contract tests PASS. |
| High | Careers roots and careers-control-compat.css | Careers inherited full-page marketing layout and SVG illustration sizing. A growing global override stylesheet masked the ownership conflict and made rendering order-sensitive. | Isolate reused brand chrome from application content; remove the compatibility stylesheet and its import. CSS Modules own layout and controls. Existing injected-marketing-style and strict icon geometry assertions retained. All visual/history scenarios PASS after correcting two original oversized icon variants in their owning rules. |
| Medium | careers-public.tsx | A position/privacy version changed during application could lead to repeated conflicts without a safe UI recovery path. | Explicit Review updated position. Preserve contact/local files; retain only unchanged question definitions, clear redefined answers, and revisit consent. Independent-browser admin edit during application tested through successful persisted receipt. PASS. |
| Medium | service.saveSettings | The idempotency fingerprint omitted expectedVersion. Reusing a request identifier with a different optimistic version could return a previous success rather than a conflict. New baseline test reproduced it. | Include normalized settings and expectedVersion in the fingerprint. Exact retry succeeds, altered request conflicts. PASS. |
| Medium | service.removeUpload | Retrying a completed removal returned an error for the already-missing file. | Missing-file removal is an idempotent success; active upload protections remain. |
| Medium | functions/careers.js and http.js | Runtime construction occurred before the HTTP enable/authentication gates, potentially producing infrastructure failures even for disabled or unauthenticated requests. | Lazy service factory resolved within the guarded handler. Tests assert disabled/unauthenticated requests do not initialize storage/SMTP/scanner adapters. PASS. |
| Historical / verified | use-careers-navigation.ts | Earlier failures followed loss of Next's router state in the initial history entry. That correction already existed in the audited baseline. | Preserve it rather than add a second routing system. Eight unchanged native Back/Forward/deep-link/scroll/file-retention scenarios rerun and PASS. |
| Process | PR and progress reporting | Stale descriptions said no persistent backend existed and did not reconcile latest tests. | Replace PR status with exact runtime/test evidence, distinguish emulator-backed integration from actual production activation. |

## Fresh adversarial pass

Performed separately from implementation, not inferred from CI color:

1. Re-read the complete changed candidate contract, service/HTTP initialization and revision-recovery paths. Challenged missing, oversized, malformed and stale inputs; checked that UI validation never replaces server validation.
2. Re-examined upload reservation, storage write, finalization, delayed exceptions, exact retries, concurrent lease replacement, application adoption, orphan cleanup and generation-bound reads. Both a lost storage acknowledgement and a lost Firestore acknowledgement have separate real-emulator coverage.
3. Re-read existing authentication and rule boundaries. Direct client access to new Careers collections and careers-private objects remains denied by the existing final catch-all rules. Server rechecks active admin identity; revoked/unauthorized identities do not replay writes. No production rules or role grants were changed.
4. Re-read email/retention workers and infrastructure setup. SMTP acceptance is not delivered mail; ambiguous delivery remains delivery_unknown and is not blindly resent. Scanner and SMTP doubles in browser tests were identified explicitly. Throughput/backlog limitations remain recorded below rather than claimed solved by this audit.
5. Compared local changed-source diff and remote changed-file comparison. The audit did not alter existing Scheduling/Dispatch/CRM/Maya/Projects/Inventory implementations or global website styles. Existing public brand components were reused without modification. Temporary read-only source snapshot workflow was removed; no write-enabled test workflow or production credentials were added.
6. Inspected actual compiled screenshots, including the 1649px desktop role layout and persistent applicant profile. Confirmed icon/text containment, circular navigation controls and the existing DEMAC public/admin visual identity. Automated mobile geometry is not a physical-device claim.
7. Kept every existing visual/history assertion intact. The first audit build failed a strict <=32px visible-icon check. Fixed the component's 36px placeholder and 44/38px success variants in the original local rules; did not relax the test or restore global overrides.

## Verification at final runtime 6d0608ba9f1370d93ef3710bf86901611c1453d8

| Evidence | Exact result |
| --- | --- |
| Local core/files/HTTP plus architecture fault tests | 16/16 PASS; baseline architecture regressions were 0/2 PASS before correction. |
| Portable browser/server, revised-draft and brand-boundary tests | 18/18 PASS locally and in CI. |
| Careers backend integrity run 34286355980 | Both recruitment-integrity and recruitment-browser-integration jobs SUCCESS. |
| Real demo Firestore/Storage tests | Existing ten persistence/security/concurrency tests and two orphan/finalization recovery tests PASS. No production connection. |
| Backend browser integration artifact 10079713189 | Chromium 145.0.7632.6 and WebKit 26.0 PASS. Twelve verified outcomes each, including admin create/reload/publish, invalid URL feedback, changed-form recovery, actual private emulator storage, commit-response failure/retry, candidate browser closure followed by admin retrieval, and persistent notes/stage/photo. |
| Careers Preview UI run 34286355761; artifact 10079714748 | Six visual/form scenarios PASS, 46 checks each. Eight native history/geometry scenarios PASS, 33 checks each. These are repeated scenario checks, not 540 distinct test cases. |
| Browser coverage | Chromium at 320/390/1024/1366/1649/1920 widths, WebKit mobile/desktop, Firefox desktop including dark-mode visual scenario. |
| ERP Next CI PR run 34286360419 | validate and field-functions SUCCESS: full typecheck/build, project phases/autofill/typography, dispatch/lifecycle/booking, live scheduling, employee schedule/attendance, field domain/security/offline and backend booking/field checks. |
| Other existing function regressions in Careers backend CI | Booking, field authority, customer-agent tools/router and transactional WhatsApp suites PASS. |
| TypeScript and web build PR run 34286360392 | SUCCESS. |

Fixtures use synthetic candidate data only. The browser integration server uses actual demo Auth/Firestore/Storage emulators, with controlled scanner/SMTP doubles; it does not prove a deployed antivirus or real email delivery. No existing mandatory gate was disabled, deleted, skipped or weakened to obtain PASS.

## Decision

- [ ] Unconditional production approval
- [x] Audit repairs verified with recorded release prerequisites
- [x] Keep production activation blocked until prerequisites below are verified

No merge, automatic merge, production deployment, production flag changes, secret changes or real candidate writes were performed as part of this audit. The owner's earlier business approval remains recorded; it does not fabricate missing technical/configuration evidence.

## Residual risks and release prerequisites

| Item | Owner / due | Disposition |
| --- | --- | --- |
| Actual Careers sender and private antivirus | DEMAC release maintainer; before live intake | Configure and verify approved SMTP sender/TLS and private scanner with current signatures. Execute separately authorized real receipt/security tests. No values or successful deliveries were invented. |
| Recruitment notice and retention | DEMAC business owner and release maintainer; before accepting personal documents | Approve actual notice/version and retention periods, then verified setup/intake controls. No new legal compliance claim. |
| Worker budget and backlog fairness | Engineering; before sustained live traffic | emailTick processes bounded batches sequentially under a 90-second invocation limit; slow SMTP can create uncertain-delivery states. Cleanup scans bounded batches and future-dated jobs can delay other eligible work. Measure workload and add budget/fairness controls with dedicated failure tests before claiming volume readiness. Existing ambiguity safety remains intact. |
| Search scale | Engineering; before materially larger recruiting volume | Public jobs capped at 100; admin scans bounded 200-record pages with cursors. This is not an indexed unbounded full-text search service. |
| Native devices | QA; before broad public rollout | Test actual Mac Safari, iPhone and Galaxy file pickers, keyboard and back gestures. Browser-engine emulation is not physical hardware certification. |
| Anonymous Vercel preview access | Deployment owner; before distributing preview links | Earlier shared links still redirected to login. That is separate deployment-access configuration, not a candidate data or routing fix. Do not disable project-wide protection or claim a new anonymous URL is verified without testing it. |
| Draft persistence | Product/engineering; documented behavior | Unsubmitted draft answers/files remain tab-memory-only; refresh/closure can lose them. Accepted applications are persistent. Recovery during an open tab does not imply offline/autosave support. |

## Deployment and recovery plan

Keep frontend/live/backend guards unchanged during review. Complete private scanner, sender, notice and retention setup in an isolated approved environment; save intake OFF, verify, test real end-to-end receipt, and only then enable live intake under the existing Human Approval Boundary. Pause intake or disable Careers flags to recover operationally, retaining submitted records and leaving other ERP modules untouched. Do not roll back to the upload-error handler that could delete committed bytes. No data migration or destructive rewrite is required by these repairs.
