# Review: planned emergency and weekly-rest overtime

## Review mode
- Solo Maintainer Adversarial Review, separately performed after implementation.
- Builder/reviewer: Codex. This is not an independent review.
- Scope: entire task diff on `fix/scheduling-planned-overtime`, main baseline `bd23d514`;
  specialized office facade/booking transaction, existing capacity and lifecycle readers,
  ERP Next agenda/create drawer, transport recovery, and direct regression consumers.

## Findings and corrections
| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | Legacy start normalization clamps an emergency at 17:30 to an ordinary 15:30 anchor. | New weekly-rest interval validation uses the exact normalized clock time; adjacent emergency and overtime boundaries are tested in both insertion orders. |
| Medium | Moving an accepted rest booking could retain its previous capacity end and slot markers. | Both ordinary move and reschedule clear the current planning marker, update capacity end, preserve audit, and have regressions. |
| Medium | Escape could close a drawer while a committed response was unresolved. | Capture-phase guard preserves pending/recovery state; browser verifies Escape and exact original request recovery after a deliberately lost response. |
| Low | Accepted weekly-rest work appeared as an invalid-calendar correction. | Accepted overtime has its own label; ordinary-calendar attention remains for unavailable Vans/company closure and unapproved exceptions. |

## Authority, concurrency and recovery
- Existing office authentication is the entry boundary; facade ignores client actor and supplies
  the authenticated office identity. Unauthenticated/inactive/non-office protection remains.
- Canonical Customer/Property/work types, weekly Van window, dated crew, staff absence and
  same-day work are read before transactional writes. All regular crew must remain available;
  duplicate dated crew is rejected. Preparation/cancel writes nothing.
- Full BAL slot ownership plus shared BAH serialization prevents overlapping bounded/emergency
  commits. Firestore retries re-read current work, locks and schedule. Exact request fingerprints
  and server-derived consent prevent changed-payload replay/stale acceptance. Lost response uses
  the same request and consent; cancellation releases only locks owned by the appointment.
- No direct production writes, migration, permission-rule change, notifications, real customer
  booking, attendance or payroll mutation was performed in this task.

## Verification
- 133 focused/transitive Node tests passed (special booking, regular lifecycle/move, capacity,
  office facade, canonical scheduling provider/engine); dedicated new move regression passed.
- Real loopback Firestore: 6 new weekly-rest/future tests and 8 existing manual-move tests passed,
  covering concurrent duplicates, competing reservations, emergency races, permissions, stale
  schedule, read-only preparation and ordinary availability.
- ERP Next typecheck, scheduling/attribution/cards/drag acceptance and production build passed.
  Firebase syntax validation and syntax checks of new/changed specialized modules passed.
- Real React Scheduling, real client transports and office facade against synthetic Firestore:
  future emergency creation, blocked rest entry, both confirmation cancellations, four services,
  exact retry after lost response, Escape recovery protection and persisted refresh assertions
  passed; desktop/mobile screenshots inspected. No external requests or page errors.
- The additional `agent-browser` CLI smoke is blocked by its daemon failing to start in this
  sandbox. This failure remains explicit in the script and is not reported as PASS. Equivalent
  browser flow assertions above ran in Chromium headless shell through Playwright; full Chrome
  also could not start because the sandbox denies its Unix process-singleton socket. No sandbox
  policy or check was weakened to resolve either tool limitation.

## Decision and release boundary
- Functional review: pass with recorded tooling limitation above; no unresolved product finding.
- GitHub CI / Vercel preview: pending publication at review writing; attach exact head status in PR.
- Production merge/deploy explicitly authorized by the owner on 2026-09-29 ("puedes hacer merge y deploy"). Deploy `officeBookingAuthority` together
  with ERP Next. A frontend-only preview still calls the currently deployed backend and therefore
  is not proof that the new overtime endpoint is live.
- Residual risk: synthetic tests do not exercise production Firebase credentials, deployed triggers
  or customer communication delivery. Existing delivery authority is unchanged. Owner: maintainer;
  verify deployed endpoint and frontend revision after owner-approved release.

## Publication blocker
- Local implementation commit: `d34b70b4cc62edc7951db09c377c0ace72c2eb80`.
- Automatic approval review rejected `git push -u origin fix/scheduling-planned-overtime`.
  After verifying that the connected GitHub user `demac-aruba` owns the repository and has
  admin/push permissions, a second review still rejected publication: this is a public GitHub
  repository and no end-user-authored instruction explicitly authorizes publishing this change.
- No alternative upload/API path was used. The branch remains local; PR, remote CI and Vercel
  preview remain pending explicit owner authorization to push and open the PR. Production was
  not changed. This is an approval blocker, not a product-test failure.

## Publication authorization received
- On 2026-09-29 the owner explicitly requested "puedes hacer merge y deploy", resolving the
  publication blocker above and authorizing branch publication, PR, merge and production deployment.
- Proceed through the normal GitHub CI and existing production deployment workflows. Release
  outcome and exact revision evidence will be recorded in the PR.
