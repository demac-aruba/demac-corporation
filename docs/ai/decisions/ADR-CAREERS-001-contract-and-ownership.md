# ADR-CAREERS-001: One form contract and explicit Careers ownership boundaries

- Status: Proposed; implemented on the audit branch, subject to final Deep Review and release prerequisites.
- Date: 2026-09-08
- Owners: DEMAC engineering; Christian owns business/release approval.
- Related task/rules: `../tasks/CAREERS_ARCHITECTURE_AUDIT_20260908.md`; CAREERS-FORM-001, CAREERS-FILES-001, CAREERS-UI-001, CAREERS-RELEASE-001 below.
- Supersedes: the component's compatibility stylesheet and duplicated candidate validators, not any operational ERP authority.

## Precedence rule
A later approved ADR must explicitly supersede this decision before reintroducing a second form contract, global override chain or independent record authority. No unrelated ERP ADR is replaced here.

## Context
The existing branch already has server-side recruitment persistence, immutable submission snapshots and tested native navigation. An earlier readiness summary no longer matched that code. Inspection/reproduction instead found independent browser/server validation, inherited marketing illustration/page CSS, and cleanup queued after an ambiguously successful upload-finalization transaction. The first two newly added fault-injection tests failed against the baseline, while its existing thirteen unit tests passed.

## Decision
1. **CAREERS-FORM-001** — `functions/careers/form-contract.js` is a portable, side-effect-free definition of candidate field types and validation. A declaration file exposes exact supported types to Next. It has no Firebase/Node/DOM imports. Browser feedback and the server invoke the same functions; privacy versions, authorization, persistence and publication remain server decisions. Dates, web URLs, choice shapes and conditional ancestry are validated consistently. Changed question definitions cannot silently reuse previous answers during revision recovery.
2. **CAREERS-FILES-001** — A thrown transaction error is not proof that a file was not adopted. Resolve the session and submitted application's ownership transactionally before rejecting the reservation or creating deletion work. A clean committed record is returned on exact retry. An application-owned object is never deleted by delayed upload-failure handling. Unknown read outcomes defer to existing lease/expiry recovery instead of guessing.
3. **CAREERS-UI-001** — Existing `PublicHeader`, `PublicFooter` and `PublicBrand` remain the brand components. Careers content is outside `.public-site`, which owns unrelated marketing viewport/illustration styles. Local CSS Modules own controls and layout. Remove `careers-control-compat.css` rather than adding another override layer. Reused public color tokens are tested against the existing website's values.
4. **CAREERS-RELEASE-001** — Design preview, emulator-tested server workflow and production activation are different states. Keep their flags and data boundaries explicit. No live sender, scanner, retention approval or anonymous preview access is inferred from a successful build. Disabled/unauthenticated HTTP requests must not initialize file or mail services.

## Authority map
| Boundary | Owner | What it does not own |
| --- | --- | --- |
| Identity / authorization | Existing Firebase Auth and governed `users` records, rechecked by server | No Careers-created user roles |
| Candidate input semantics | Portable form contract, revalidated by Careers authority | No persistence or security decision in the browser |
| Recruitment truth | Existing branch's `functions/careers/service.js` and `careers*` collections | No employee, CRM, scheduling or payroll writes |
| Private bytes | Existing Careers private-storage adapter, scanner and generation-bound reads | No public permanent file links |
| Delivery / retention | Existing gated worker and infrastructure adapters | No fabricated email delivery or unconditional resending |
| Website brand / component layout | Shared brand components / scoped Careers CSS | No global marketing selectors around the form |

## Alternatives considered
| Alternative | Benefit | Risk / why not selected |
| --- | --- | --- |
| More high-specificity SVG/CSS overrides | Fast visual workaround | Retains conflicting ownership and ordering dependencies |
| Copy server validation into the form | Low immediate effort | Recreates drift on the next question type or limit change |
| Delete a file whenever upload throws | Simple catch block | Can delete already committed or submitted bytes |
| Replace all routing / rebuild another backend | Broad apparent simplification | Discards already working boundaries and expands regression risk |

## Consequences
- Positive: fewer independent rule sources; truthful recovery; removal of compatibility patch chain; testable cross-layer contract.
- Tradeoffs: frontend now depends explicitly on a portable file under the backend subtree. CI must include this dependency in path filters.
- Security/privacy: no new collections, role grants, production rules, credentials or live data. Preserved drafts remain browser-memory-only before submission; revision requires renewed consent.
- Operations: scanner/SMTP deployment, live receipt tests, real-device checks and worker capacity remain separate release evidence. Existing bounded-list limits are not full-scale search guarantees.
- Migration: no stored record rewrite; no data migration. Existing accepted snapshots stay immutable.

## Verification and rollout
- Acceptance evidence: companion audit/review record and exact CI heads; not merely a green deployment.
- Observability: current error codes, mutation audit and email states preserved. No PII in test logs or artifacts; fixtures are synthetic.
- Recovery: fix forward in the audit branch. Do not roll back to the unsafe upload-error catch. Production flags remain off until a separately verified release.
- Review triggers: any new question kind, upload state, public CSS wrapper, privacy policy version, transport or retention policy.
