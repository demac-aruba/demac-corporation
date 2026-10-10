# Review: centered booking workspace and preserved Scheduling workflows

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: Codex `/root/booking_review`.
Implementation author / agent: Codex `/root`.

The reviewer did not implement product code. The reviewer authored the isolated
`booking-modal-browser.cjs` verification harness and this record; the Builder reviews
that harness. Product findings below come from an independent baseline audit, full
product diff inspection, real-component browser execution and screenshot inspection.

## Scope reviewed

- Owner request: replace the long side drawer with an approved centered workspace,
  retaining every existing booking feature and workflow. Deep audit is required before
  the already authorized merge and production deployment.
- Baseline: `fc09e0be77f22ec67b87af66f546a0464fc7a11a`. Review covers the task diff in
  `live-appointment-create-drawer.tsx`, its scoped stylesheet, `adhoc-support-drawer.tsx`,
  new support stylesheet and booking-dialog hook, the agenda Escape guard, and additive
  browser CI gates. Review includes the corrected footer duration expression and the follow-up source-button
  accessible-name correction identified by the existing integrated coworker-support CI gate.
- Affected callers/integrations: `LiveSchedulingOverview`, `AfterHoursEmergencyDrawer`,
  `PropertyEditor`, `PropertyLocations`, `PropertyCommunicationPanel`,
  `VisitReferenceEditor`, `ProjectBudgetConfirmation`, canonical booking transports.
- Authority mapping: CRM owns Customer/Property/Contact identity; Booking Authority owns
  availability, Appointment/Work Order/locks and commit-time validation; Project Authority
  retains Project planning and projection permissions; existing visit-reference and
  WhatsApp authorities retain uploads and delivery. No authority or data model changes.
- Rule families: `OPS-SVC-*`, `OPS-TEAM-*`, `OPS-SCHED-*`,
  `OPS-SCHED-SUPPORT-001`, `OPS-SCHED-REFERENCES-001`, `OPS-PROJ-SCHED-001`,
  `OPS-SCHED-PROJECT-BACKDATE-001`, `OPS-SCHED-PLANNED-OT-001/002/PROJECT`,
  `OPS-SCHED-CREATE-OT-001`, `CRM-LOCATION-001`.

## Findings

| Severity | Location | Evidence and impact | Required correction / outcome |
| --- | --- | --- | --- |
| Medium, resolved | Booking modal and owning agenda Escape handlers | Existing agenda handler could dismiss the parent when nested property/budget dialogs received Escape, and could discard the UI during uploads/master saves. Reusing the generic child focus hook for the parent would cause competing traps. | Dedicated parent hook defers to visible child dialogs, blocks dismissal during busy/recovery states, traps parent focus and restores focus; agenda explicitly defers while a booking modal exists. Browser cases verify nested Escape, Tab/Shift+Tab, focus restoration and upload/recovery protection. |
| Medium, resolved | New footer workload summary | Initial footer passed the `allocationDurationLabel` function as a React child, omitting the duration in the screenshot. | Builder invokes the existing helper with the selected allocation and estimate, using the existing Project slot label for Projects. Browser assertions now require the visible computed workload at all three viewport sizes. |
| Medium, product correction reviewed; CI rerun required | Responsive source buttons | Existing coworker-support CI could no longer locate the complete support action name when responsive CSS hid its descriptive span. The visual compacting also removed that description from the accessible name. | Builder added explicit full `aria-label` values to Regular Booking, Project and Send van support, preserving the original names at all viewport sizes. Existing test selectors and gates remain unchanged. The independent modal suite now asserts all three complete accessible names at 1440, 1366 and 390 px; the previously failing integrated CI gate must pass on the corrected commit. |
| Release hygiene, pending final staging check | Build-generated files | Local dependency installation/build regenerated package locks, `next-env.d.ts` and `tsconfig.json`; these are outside the UI request. | Builder must exclude unrelated generated changes from the final commit. This review does not approve such changes. |

No unresolved product-code defect was found after the footer correction. No existing
input, conditional domain branch, service/hold/confirm action, mutation payload, permission
check, validation signature, request ID or recovery closure was removed or replaced.

## Verification

Reviewer executed:

- `node --check apps/erp-next/scripts/booking-modal-browser.cjs` — PASS.
- `git diff --check` — PASS at review time.
- The real-component browser suite — **12/12 PASS**, using isolated Playwright 1.57
  and the supplied local Chromium executable. All requests outside its loopback fixture
  were blocked; none occurred. No browser JavaScript errors occurred.
- Desktop 1440×1000 and 1366×768, mobile 390×844: centered/stacked geometry, footer
  inside the viewport, no horizontal overflow, visible computed footer duration. Desktop
  and mobile screenshots were inspected, including captures from the top of the form.
- Complete accessible names for all three source actions are explicitly checked at desktop
  and mobile widths, including Send van support after its visible description collapses.
- Stateful references/contact editors remain connected across native disclosure toggles;
  reference notes/GPS, requester, access contact and recipient choices persist.
- Mixed-service selection and quantities, manual description/instructions and recipients
  reach the same availability payload. Confirm and hold retain their separate commands,
  original offer/option IDs and visit references.
- Lost-confirm and lost-hold responses freeze the form and prevent Escape/close; recovery
  replays the identical command and yields one synthetic Appointment identity.
- Active upload blocks close, Escape and booking confirmation; its result and explanation
  survive disclosure toggling without re-uploading.
- New customer, Add property and Edit property child dialogs dismiss independently;
  parent selections survive. Native Project budget Escape also preserves Project slots.
- Tab/Shift+Tab wrap inside the parent; nested PropertyEditor owns its own focus trap;
  closing the editor restores the initiating parent control.
- Coworker support retains selection of an existing primary Appointment, three consecutive
  slots, explicit reason and its distinct support command.
- Opening/navigation/cancelling tested editors/disclosures triggers no confirm, hold,
  CRM/contact write, upload or support command. Existing automatic availability checks
  remain unchanged; the harness does not claim that production offer generation is
  entirely write-free.

Evidence: synthetic `results.json` and layout PNGs in the isolated review output directory;
CI uploads the same categories through the new additive artifact step. No customer data
or credentials are included in fixtures or screenshots.

Builder-reported transitive verification (separate from reviewer-run evidence): 235 booking,
425 Field and 121 communication tests; seven frontend suites; references desktop/mobile;
TypeScript and final production build. The release owner must retain exact final-head
results and green required CI; this review does not waive a gate.

Security/permission review: Project capability and revocation logic, canonical CRM links,
server-side authority transports and existing child mutation paths are unchanged. No
Functions, Firebase Rules, schema, production configuration, pricing, payroll, billing,
Field completion data or existing Appointment data are modified by this product diff.

## Decision

- [x] Pass
- [ ] Pass with recorded follow-up
- [ ] Block / changes required

**Independent product review passes.** Release remains subject to final staging hygiene,
required exact-commit CI/build gates and correct production target verification. No gate
is weakened by the new CI steps.

Residual risk: browser commands use synthetic authority adapters, so these tests verify UI
state and transport invocation rather than replacing backend/emulator suites. Browser
coverage is Chromium desktop/mobile viewport simulation, not physical devices, other browser
engines or assistive-technology certification. The narrow change preserves backend behavior;
no absolute guarantee about every future data combination is claimed. Owner: implementation
maintainer; verify normal read-only post-deployment smoke before closing this release.

Human approval boundary: Christian explicitly authorized merge/deploy on 2026-10-10 after
this audit succeeds. No production test bookings, messages, migrations, data deletion,
security/access changes or secret changes were performed or approved by this review.
