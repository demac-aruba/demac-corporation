# DEMAC Technician App — first visual increment (not milestone completion)

## Scope and authority

Source baseline: 37464eaa184c60c2974f8b634379e0aec90da903, feature/technician-app-20260923, Draft PR 526.
The owner's 23 September 2026 brief and ten separate references govern the finished product. Development and an isolated preview are authorized; merge, auto-merge, production, production access changes and migration are not.

This increment connects the new Login presentation, Home, Agenda, Jobs, Profile and job context to the EXISTING AuthProvider, TechnicianFieldHome controller and Field API. It adds no parallel customer, staff, schedule, visit or evidence database. Existing command handlers, request identifiers, assignment checks, day limits and server transitions remain in use. Opening a job remains navigation only. The selected DetailView remains mounted across the four tabs. Navigation no longer paints a previously visited tab as proof of completed work.

The display-only optional `crew` DTO contains a canonical Van ID/name and at most three currently resolved crew member IDs/names/responsibilities. It is read only after existing assignment authorization and only from the matching dated/regular membership. Staff phone, email, salary and payroll fields are not projected. Direct/profile-fallback assignments do not fabricate a crew. Version 1 remains compatible when this optional field is absent; new clients validate its shape, unique staff identities and matching Van ID. It grants no permission. The helper's existing restricted command capabilities have NOT been silently expanded.

Deep Review applies to this additive private-data projection and session/navigation boundary. The remaining shared-parts, synchronization and closure task continues to require its separate risk review.

## Visual implementation and differences requiring owner review

| Screen / reference | This increment | Remaining differences |
| --- | --- | --- |
| Login / derived | Shared navy tropical header and real email/password form | Same existing password provider and account recovery through administration; no new public registration |
| Home / 01 | Identity, real assigned crew, three counts, next job, same-day rows, four-tab navigation | No generated employee or property photographs; no fictitious countdown or bell badge |
| Job / 02 | Same header, property/dwelling, access contact, scope, crew and date; existing execution controls preserved | Service body remains existing controls, not the final equipment/procedure presentation |
| Service / 03 | Existing authorized catalog and intervention controls retained | New card selection layout is not delivered |
| Parts / 04 | Not delivered | Shared indoor/outdoor ownership remains pending; no local fake claims |
| Procedures / 05–08 | Not delivered | 14/9 procedures, binary queue, safety coordination and evidence-detail presentation remain pending |
| Add-ons / 09–10 | Existing governed Field lines retained | New visual forms, helper capability extension and context linking remain pending |
| Profile / derived | Own session, assignment display, sync status and real sign-out | Photo is initials until a verified staff asset exists |

The brand uses the existing public-site DEMAC text/snowflake treatment, not a generated mockup wordmark. The decorative header is a text/person-free crop of the user-supplied `01_inicio_portal.png`: crop (435,45)-(667,220) from its 941×1672 source. It is decorative illustration, not a verified customer-property photo, evidence or a staff image. It needs visual approval/replacement with an approved full-resolution brand asset before final visual acceptance. No faces, client facade, phone frame, status bar or notification count were copied.

The counts deliberately distinguish “Terminado en campo” and “Enviado a oficina”; neither implies Office approval. Submitted work remains in the day's history but is not selected as the next physical execution. Business dates remain server-scoped to the Aruba day. Empty, loading and failure are different states; no failure is labeled no jobs.

## Isolated review environment

Reuse the existing `demo-demac-dwellings` emulator/gateway runbook and existing Auth, Firestore, Storage rules and Field factories. Only the same-origin authenticated gateway on loopback 4397 may be exposed. Auth/Firestore/Storage/hub stay on loopback 9297/8297/9397/4497. No Google credentials, real project, Firebase triggers, outbound workers, invoices or inventory consumers are loaded. An explicit synthetic frontend build overrides every Firebase field and disables telemetry. Manual external contact links are disabled in this build as well.

`technician-app-preview.yml` builds/typechecks and tests before sharing a temporary HTTPS review URL. The review process lasts 90 minutes after verification, not an indefinite production service. Authenticated writes persist in emulator backend and private Storage during the window, including reload and multiple accounts. Snapshots and test-account access are encrypted to a session-held private key that is not in the repository. Restart requires a controlled restore or a clearly new fixture; it is not a promise of permanent hosting or automatic background preservation.

Four separate synthetic users cover Technician, Helper, Office and unauthorized outside assignment. Names, dates, capacities and equipment data in this environment are synthetic and must not be imported to production. Storage access-test bytes are a labeled synthetic probe and are NOT claimed as documented maintenance evidence.

## Verification and delivery gates

Local evidence before publication: 22 Field core tests pass; 33 route regressions and additive DTO/status tests pass in a supplemental transpiled run; full component bundling succeeds. Isolated Chromium component checks pass at 360×800, 390×844 and 1365×1000: four tabs, callback-only opening, no horizontal overflow, loading/error/empty separation, no network. These are component tests, NOT authenticated end-to-end acceptance or physical-device tests.

Full TypeScript, build and existing Field/Booking/security/offline gates remain required in remote CI. The new gateway/API/browser tests must also pass before a preview link is described as verified. Evidence logs never contain passwords, tokens or raw Auth snapshots. Chromium/WebKit mobile emulation is not testing a real iPhone/Samsung device.

Hito 1 remains IN PROGRESS until shared part selection, full 01–04 comparison and the requested acceptance are complete. Hitos 2 and 3 are not complete. The source-control staging transport used to overcome terminal network restrictions is developer tooling only, removed from the resulting tree; there is no new product runtime patch chain.

## Separate reviewer checklist / release decision

Review the complete final diff and affected callers separately from implementation: read authorization before staff lookup; immutable current-day ownership; matching Crew/Van; missing/inactive staff; no new helper actions; hidden DetailView cannot expose the previous user's context; old event handlers and retry paths remain unchanged; background tab navigation is not a completion state; actual gateway/storage isolation; successful browser/API evidence.

Do not describe a solo self-review as independent. Remain Draft and block merge/production until human owner validation and the remaining milestone requirements are satisfied. This increment has no data migration; rollback is a source revert, with test snapshots kept separately.
