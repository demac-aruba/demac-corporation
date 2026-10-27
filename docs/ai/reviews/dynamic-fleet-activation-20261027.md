# Review: Dynamic fleet activation

## Review mode
Solo Maintainer Adversarial Review. Builder and reviewer: Codex; this is a separate self-review, not independent review. The reviewer re-read the owner request, the complete diff and direct consumers after implementation.

## Scope and findings
Reviewed profile validation/save masks, canonical numbering, schedule board and date summaries, capacity cache/refresh, calendar, WhatsApp client identity gate, Booking Authority transaction eligibility, original crew/rules boundaries and all new tests.

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Prepared offers could survive a Van deactivation/removal inside the transaction, particularly for older records without crewRevision. | Every selected lane is now checked in the transaction; fresh status, inactive and concurrent retry cases pass. |
| Medium | Hiding unavailable lanes would also hide their existing work. A failed fleet read could similarly remove every booking from the board. | Separate attention list opens existing appointments for unavailable/unresolved/loading-capacity lanes; no slots are offered there. Browser failure-path verified. |
| Medium | Using selected-day lanes for all week totals would undercount other dates with different daily overrides. | Week calculations use all canonical lanes, then evaluate each day's eligibility. Browser verifies a Tuesday no-personnel override leaves Wednesday capacity intact. |
| Medium | Saving profile status also wrote a default partial-day rule. | Profile-only saves preserve the schedule. Browser verifies VAN-5 Friday rule is untouched during activation. |
| Medium | UI activation with only a driver would otherwise reach the existing Firestore Disponible helper restriction. | Normalize explicit Disponible selection without regular helper to the already-supported Trabajo liviano state, require a valid driver and explain it in the form. Fresh stored crew is used; crew/history fields remain omitted from profile updates. |
| Low | A late read could repopulate the cache after profile invalidation. | Cache generation and promise-identity checks prevent older loads from replacing newer cached state. |

No unresolved blocking code finding in this pass. React Best Practices checklist applied: stable Hook order, explicit dependencies, derived lane state, existing event cleanup, parallel read boundaries and keyboard-accessible attention buttons. No new dependency or duplicated authority.

## Verification
- ERP typecheck, full production build including existing prebuild gates: PASS locally. Build-generated next-env/tsconfig changes were excluded.
- Profile acceptance and five live-scheduling acceptance suites: PASS.
- Booking Authority final combined suite: 264/264, including the 12 new dynamic fleet cases. Uses an isolated MVCC Firestore-compatible fixture, not production and not a Firestore emulator.
- Transactional WhatsApp suite: 150/150. Roster authority suite: 28/28.
- Firebase validation/prevalidation: PASS.
- Actual React Vans form → real profile mutation → synthetic persisted catalog → real capacity reader → actual Scheduling board: PASS at 1440px and 390px. Covers driver-only activation, 24→30 full-day slots, 28 total on Van 5's four-slot partial day, VAN-12, next VAN-13 creation, unavailable-lane hiding, existing-booking access, date overrides/cancellation, all-disabled fleet, capacity read failure and focus/navigation refresh. Synthetic transport only; zero external requests.
- Existing history browser: PASS at 1440px/390px, including access revocation and failure recovery.
- Existing refresh browser: PASS, 90 seconds/900 samples on each viewport, with overtime, project labels, stale responses, cancellation and session changes.
- New browser suite is added to ERP CI; new backend tests are added to the existing booking test command. No gate removed or weakened. The old VAN-5 rejection assertion was replaced with the newly requested acceptance plus missing/invalid driver and identity tests.
- `git diff --check`: PASS. No production customer/employee data, credentials, generated screenshots or artifacts in the diff.

## Release and residual limits
Code is ready for CI/product review; remote exact-head results remain required before merge. No production deployment, live-data mutation or test message was performed. No security-rule change is needed; existing operations authorization and protected roster write path remain.

The browser uses synthetic transport and the backend tests use a model transaction store; this does not claim authenticated production acceptance or real Firestore contention coverage. Existing full CI integration suites remain required. A bounded backend source/configuration audit must precede production publication, followed by the frontend on demac-aruba.com. Existing source/configuration/IAM and rollback must be preserved. Live operational capacity uses the established periodic read model; entry/focus forces fresh reads and same-session successful profile saves invalidate the cache. Other active clients converge on their normal polling cycle. New Vans need their own explicitly configured WhatsApp group; no recipient is invented. Crew roster synchronization remains unchanged.

On 2026-10-27 the owner explicitly authorized source publication, merge and deployment: ‘Sí, autorizo publicar, hacer merge y deploy.’ This satisfies the AGENTS.md production approval boundary for this correction.

## Publication state

Local implementation commit: `9851638`. The Git push was rejected by automatic approval review because implementation authorization was not considered explicit authorization to publish these source changes to public GitHub. No workaround was attempted. A read-only branch search confirmed no remote task branch exists. Local source is committed; exact-head CI, preview, merge and deployment remain unperformed pending owner approval. All unaffected local verification above is complete.

The owner subsequently granted explicit publication/merge/deploy approval. Publication now proceeds through the authenticated GitHub connector because local Git has no write credentials. A read-only production source audit will verify the current exact runtime and test a candidate changing only the two scheduling modules; bootstrap, dependency declarations, configuration, IAM, traffic and security rules remain unchanged.

## Authorized release review

Read-only GitHub Actions audit `40572896671` completed successfully against `officebookingauthority-00092-keb`. The audited production package passed 143 baseline tests; the exact two-file candidate passed 155 tests, including all 12 dynamic-fleet cases, clean dependency installation, the real bootstrap, CORS and anonymous denial. The audited immutable ZIP, source/configuration/IAM hashes and candidate hash are retained in `docs/ai/releases/dynamic-fleet-audit-20261027.json` (artifact SHA-256 verified before import).

A separate adversarial release pass compared the bounded publisher with the previously reviewed Van roster publisher. Only the two scheduling modules can change. The existing source-only PATCH, immutable private recovery archives, lost-response reconciliation, configuration/IAM equality, drift rejection, branch/commit gates and full-traffic verification are preserved. No Rules publication or data migration is present. All 18 release/transport/retry tests pass locally; remote safety CI is required on the final head. The frontend is published only after the bounded backend completes and verifies both production origins. Failed or ambiguous publication stops the sequence and retains exact source recovery without an automatic destructive rollback.
