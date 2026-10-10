# Task: Centered Booking workspace with workflow preservation

## Context

- Owner approved the visual proposal and explicitly authorized merge/deploy on 2026-10-10, conditional on a deep compatibility and data-safety audit.
- Surface: ERP Next Scheduling; office booking of regular services, Projects, overtime/after-hours and coworker support.
- Existing narrow right drawer requires long vertical traversal. Replace the container and organize existing controls, preserving business behavior.

## Scope

- Center regular/Project/special booking in a wide responsive modal with fixed header, appointment context, booking type and actions.
- Three desktop columns: customer/property; work and visit references; live capacity. Stack on narrow viewports.
- Native details for contacts/messages and references retain mounted child state, effects and staged upload ownership.
- Center the existing separate coworker support flow with its existing commands and eligibility.
- Add modal focus management, restore focus, scroll lock, nested editor dismissal and pending-operation protection.
- No backend, API, auth, role, schema, migration, dependency declaration, deployment configuration, customer communication policy or existing appointment changes.

## Governance

- Mode: Deep Review, explicitly requested. Builder: primary Codex agent. Independent implementation reviewer/QA: booking_review agent, as preferred by AGENTS.md.
- Authorities: Booking Authority owns offers, commit-time capacity, appointment/work-order/locks, holds, support, overtime and retries. CRM owns Customer/Property/Contact/dwellings and assignments. Project Authority owns published project links and budgets. Communication Authority owns recipient processing. UI remains a consumer.
- Rules: OPS-SCHED-SUPPORT-001, historical OPS-SCHED-* acknowledgements, OPS-SCHED-REFERENCES-001, OPS-PROJ-SCHED-001, OPS-SCHED-PROJECT-BACKDATE-001, OPS-SCHED-PLANNED-OT-* and OPS-SCHED-CREATE-OT-001.
- Legacy parity: no legacy implementation modified. No claim of global ERP/legacy parity; preservation audited against the current live ERP Next Booking implementation.
- Security/privacy: synthetic fixtures only, external browser traffic blocked. No production records created/updated for verification; no secret/PII fixture content.

## Feature preservation matrix

| Existing feature | Preserved implementation and verification |
| --- | --- |
| Search/create canonical customer; select/add/edit property; address completion | Same components/handlers, nested editor Escape browser cases; existing address CI |
| Independent dwellings, requester and access contact | Same PropertyLocations key and selections/readiness; actual components in browser fixture |
| Contacts, confirmation/reminder recipients | Same mounted PropertyCommunicationPanel/handlers; collapse-expand and exact offer payload assertions |
| Service presets, quantities, Other duration, descriptions, technician instructions | Same Work & allocation subtree and handlers; actual presets/quantities and offer payload browser assertions |
| Photos/video/audio, explanations, order, GPS, visit notes | Same mounted VisitReferenceEditor; retained draft/upload guard tests plus existing full reference editor/technician reader desktop/mobile tests |
| Published Projects, roles, canonical customer/property, phases/slots and budget warning | Same project source/picker, role guards and budget components; project acceptance, CI budget browser, nested native dialog test |
| Past-date acknowledgement, no historical customer messages/hold | Same predicates and handlers; backend historical capacity tests and live scheduling acceptance |
| After-hours/open-ended and weekly-rest overtime including Projects | Same mode predicates, start editor, capacity panes, confirmation/consent and command handlers; backend and scheduling acceptance |
| Automatic capacity validation, exact primary/support slots, conflicts | Same debounce/abort/signature and commit-time authority; booking/dispatch/lifecycle tests |
| Confirm, temporary hold and uncertain-response recovery | Original request IDs, frozen payload/recovery and action predicates; four actual-component browser command/retry scenarios |
| Coworker support, consecutive slots, reasons, historical correction | Original separate component commands/eligibility; actual 3-slot browser command plus authority suite |
| Existing appointment details/move/cancel, Work Orders, Field and notifications | No implementation changes; lifecycle, Field and transactional communication regression suites |

## Acceptance criteria

- [x] Desktop uses centered columns with viewport-contained fixed footer; mobile retains reachable controls and no horizontal overflow.
- [x] All current fields/actions remain present in their existing modes and permission conditions.
- [x] Collapsing sections retains current form state and does not initiate appointment/master writes.
- [x] Nested dialogs own Escape; pending writes/uploads/recovery block parent dismissal; Tab stays within the active modal.
- [x] Confirm/hold/support use unchanged authoritative commands; exact uncertain-response retry creates one synthetic result.
- [x] Audit and regression evidence recorded separately; mandatory CI required before merge.

## Plan and risk

- Reorganize JSX/CSS, retain domain logic; add a scoped modal lifecycle hook. No broad component rewrite.
- Inspect complete diff and transitive child dialogs, compare source against live deployment, use independent reviewer and real-component browser tests.
- Production baseline: Vercel demac-corporation-web / prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7, deployment dpl_6TGrZRX7uNy6VgyGVHAMDynakERS, SHA b10ae55898b86fd3e446384c67e57350e32a4d87. It differs from main fc09e0be77f22ec67b87af66f546a0464fc7a11a only by an operational release document; application/backend sources are identical.
- Merge after gates using existing [merge-only] convention to avoid unrelated automatic production publications, then explicitly deploy this frontend to verified demac-aruba.com project. No Functions/rules/database deployment.
- Rollback: restore the previous ready frontend deployment/alias. There is no data migration or data rollback.

## Verification

- TypeScript plus production build (including unmodified prebuild suite); final CI includes all existing checks, with additive booking modal/reference browser gates.
- Frontend acceptance: dispatch, lifecycle, booking intelligence, booking copilot, live scheduling, projects preview, project slot progress.
- Backend syntax; 235 booking authority, 425 Field authority and 121 transactional WhatsApp tests passed (781 total, zero skipped/failures).
- Actual booking components with synthetic adapter: 12 browser scenarios at 1440x1000, 1366x768 and 390x844, form state, command parity, recovery, uploads, nested dialogs, focus and support.
- Existing reference suite passed desktop and mobile-dark, including three file types, metadata/order, saved updates, reader view and recovery, zero external requests.
- Residual: synthetic authority tests do not prove live transport health or every production dataset. Post-deploy verification is read-only; no live customer/appointment writes used as probes. No finite audit promises zero future defects.
