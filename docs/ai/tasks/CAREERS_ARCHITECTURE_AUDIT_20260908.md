# Task: Careers architecture audit and root-cause repairs

## Context
- Request/source: Christian requested an architecture audit and professional, efficient root-cause repairs, following AGENTS.md, after repeated preview/navigation/backend failures on 2026-09-08.
- Delivery mode: Deep Review. Preserve the approved DEMAC brand and working ERP behavior. Keep PR #494 in draft until technical gates and release prerequisites are actually satisfied.
- Audited starting head: c3b2146c0175069394946099e5242b3a216af82d; main: 4d94b55536268120e7c23de9c8271ed03e192da0. The old PR description was stale: later commits had introduced persistent server behavior. Code and latest test evidence were used instead of conversational status.
- Final tested runtime: 6d0608ba9f1370d93ef3710bf86901611c1453d8. A later documentation checkpoint does not change runtime behavior.

## Scope
- In scope: candidate/admin domain contracts, navigation lifecycle, stylesheet ownership, server authorization, concurrent edits, submission/upload/email retry and recovery, configuration/readiness, tests and engineering documentation.
- Out of scope: production deployment/activation, credentials, security-rule changes, real personal data, marketing redesign, existing Scheduling/CRM/Maya/Inventory/Projects business behavior.
- Boundaries: Careers components/hooks/model; Firebase Careers service/adapters; isolated tests and engineering records. No new source of truth introduced by the audit.

## Governance
- Authority owners: existing Firebase Auth/users for identity, functions/careers for recruitment records, existing authorities for all operational ERP domains.
- Security/privacy: candidate profile, photo and documents require server authorization and private storage; no real records or live mail used in tests.
- Legacy parity: N/A, no Legacy changes. Domain rules remain outside presentation.
- ADR: `../decisions/ADR-CAREERS-001-contract-and-ownership.md` records contract/ownership decisions and release limits.

## Acceptance criteria and outcome
- [x] Distinguished previously fixed defects, reproducible current defects and unconfigured external services.
- [x] Shared candidate form types/validation, including conditional/date/URL fields; revision recovery does not reinterpret changed answers.
- [x] Native Back/Forward verified across eight scenarios with preserved values/files and duplicate-submission safeguards.
- [x] Careers content has scoped layout ownership; obsolete global compatibility stylesheet removed.
- [x] Unauthorized/private-read, revoked-role, version/retry and file-finalization cases verified with existing and new tests.
- [x] Actual compiled browser workflow and persistent storage tested in demo emulators; scanner/SMTP doubles identified explicitly.
- [x] Existing mandatory regression gates preserved and final relevant runs passed.
- [x] Fresh separate Solo Maintainer Adversarial Review and residual risks recorded.

## Execution
1. Recovered exact tracked source and reconciled stale PR/test reports.
2. Added two root-cause fault-injection tests and observed both fail on baseline.
3. Implemented one portable candidate contract, ownership-aware file recovery, guarded service initialization and component-owned styling; preserved working native routing.
4. Ran existing/new unit, emulator, browser and operational regression suites. Fixed icon-size failures in component rules, not assertions.
5. Completed separate adversarial review and explicit production/real-device/backlog prerequisites. No auto-merge or production activation.

## Verification / handoff
See `../reviews/CAREERS_ARCHITECTURE_AUDIT_20260908.md` for exact CI run/artifact IDs, before/after findings, tested outcomes and release prerequisites. Audit repairs are verified; production activation remains gated by actual infrastructure, approved data policies and remaining release validation.
