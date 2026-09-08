# Task: Careers architecture audit and root-cause repairs

## Context
- Request/source: Christian requested an architecture audit and professional, efficient root-cause repairs, following AGENTS.md, after repeated preview/navigation/backend failures on 2026-09-08.
- Delivery mode: Deep Review. Preserve the approved DEMAC brand and working ERP behavior. Keep PR #494 in draft until technical gates and release prerequisites are actually satisfied.
- Audited starting head: c3b2146c0175069394946099e5242b3a216af82d; main: 4d94b55536268120e7c23de9c8271ed03e192da0. The PR description is stale: later commits introduced persistent server behavior. Verify code and tests rather than treating the previous conversation summary as current truth.

## Scope
- In scope: candidate/admin domain contracts, navigation lifecycle, stylesheet ownership, server authorization, concurrent edits, submission/upload/email retry and recovery, configuration/readiness, tests and engineering documentation.
- Out of scope: production deployment/activation, credentials, security-rule changes, real personal data, marketing redesign, existing Scheduling/CRM/Maya/Inventory/Projects business behavior.
- Expected boundaries: Careers components/hooks/model; Firebase Careers service/adapters; isolated Careers tests and engineering records. Do not introduce another source of truth.

## Governance
- Authority owners: existing Firebase Auth/users for identity, functions/careers for recruitment records, existing authorities for all operational ERP domains.
- Security/privacy: candidate profile, photo and documents require server authorization and private storage; no real records or live mail in tests.
- Legacy parity: N/A, no Legacy changes. Domain rules must not migrate into presentation.
- ADR: record the chosen contract and ownership corrections using the repository ADR template. Record any unresolved deployment prerequisites explicitly.

## Acceptance criteria
- [ ] Distinguish previously fixed defects, reproducible current defects and unconfigured external services.
- [ ] Candidate/admin form types and validation agree, including conditional, date and URL questions; published version changes cannot silently reinterpret existing answers.
- [ ] Native Back/Forward preserves router state, form values and files; one submitted request cannot create duplicate records.
- [ ] Careers styles have a single scoped ownership boundary; no accumulating global compatibility overrides.
- [ ] Private records and documents remain denied to unauthorized readers; stale/concurrent administrative mutations and retries have deterministic semantics.
- [ ] Actual full browser flow and persistent storage tests pass in isolated demo emulators; report scanner/SMTP doubles honestly.
- [ ] Existing mandatory regression gates remain intact, no weakening or bypass for a green result.
- [ ] Fresh separate Solo Maintainer Adversarial Review, exact evidence and residual risks documented.

## Plan and risk
1. Recover exact current source and latest CI evidence. Inspect nearer AGENTS.md and relevant domain consumers.
2. Reproduce findings with targeted failing tests before changing behavior.
3. Make one coherent correction per ownership boundary, removing superseded local mechanisms rather than layering overrides.
4. Run existing and added gates, inspect actual rendered evidence, then separately challenge the complete diff.
5. Update PR #494 and report exactly what is repaired, tested and still gated. No auto-merge or production activation during this audit.

## Verification
Baseline, reproduction, final test results and not-run areas will be recorded in the companion audit/review record. Production services and real Mac/iPhone/Galaxy hardware are not implied by local browser emulation.
