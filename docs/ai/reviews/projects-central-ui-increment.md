# Review: central Projects workspace and transport

## Mode and scope

Solo Maintainer Adversarial Review by the implementation author, ChatGPT. This is NOT an
independent review. The second pass examined the newly added central UI, transport, intent
journal, HTTP adapter, DTOs, test boundaries and their callers in the existing registry.
The active `/projects` and Scheduling writers are not replaced by this increment.

## Findings and corrections

- Initial modal busy handling could trap the user behind a dialog after an ambiguous save.
  Closing a form is now possible without cancelling/replacing the protected pending request.
  Recovery remains in the workspace and blocks new writes until exact-request resolution.
- A memory-only pending request would be lost on refresh. A per-user, token-free session
  journal now records exact intent before sending; unavailable storage prevents the send.
  Closing the browser session can still discard sessionStorage, so a later ambiguous result
  must be reconciled against server receipts rather than blindly recreated.
- A syntactically successful but malformed/wrong-project response could clear recovery state.
  Mutation acknowledgements now validate identity/version/success fields before cleanup;
  invalid acknowledgements retain pending evidence. Negative acceptance cases were added.
- Checklist text-area/index editing could silently transfer an existing item ID to another
  item. Individual stable-ID editors and additive items replace that approach. This editor
  deliberately does not delete or renumber existing checklist history.
- Browser acceptance exposed an unstable accessible name on a select wrapped in a label.
  Planning selectors now have explicit stable accessible names. Tests still require selecting
  the actual property, creating the plan and checking the server record; no gate was waived.
- A legitimate absent company-template key was initially treated like corrupted Projects.
  Absence is now disclosed and does not block review of a valid selected project. Malformed
  source records, duplicate identities and invalid template content remain errors. Full
  template migration/parity remains an outstanding workstream, not implicitly completed.

## Authority and failure checks

All writes still call the existing registry service. That service checks current provisioned
roles, expected versions, exact retry receipts, canonical CRM/appointment identity and audit.
The HTTP adapter adds transport validation, exact-origin CORS, redacted structured errors
and no-store responses; it grants no additional roles and initializes no Firebase SDK.
The UI's build flag defaults off, and runtime/server flags remain separate. There is no new
Functions export, deployment workflow, Firestore-rule change or live data migration.

Reads are bounded/paginated. A failed load is not an empty project; stale prior data is
labeled and editing paused. Partial activity is not a full-project total. Recorded visits
are evidence, not pause-aware actual labor. Budget remains advisory and never overrides
Booking Authority. Existing CRM references are reused only at plan creation; their current
full-reference-read limitation is not represented as a new search optimization.

## Verification record

Seven HTTP contracts and the original 16 client transport/recovery scenarios passed before
this pass. Two acknowledgement-rejection scenarios were then added, for 18 client scenarios.
The initial full ERP build passed; the first browser run failed on the select label and was
corrected. Later exact-head CI results, including Chromium/WebKit, real Auth/Firestore
emulation, lost-response/reload/retry and operational-record comparisons, must be recorded
in the PR verification comment. An earlier green build is not final browser evidence.

Tests route every external browser request to synthetic fixtures or loopback-backed handlers;
no production tokens, customers, appointments, stock or messages are used. Eight operational
collections are compared before/after the UI scenarios, not merely individual plan values.

## Decision and residual scope

Keep PR #514 DRAFT. This increment can establish tested central planning UI, not whole-module
release readiness. Automatic Booking Authority handoff, measured-time and phase-completion
sources, templates/lifecycle parity, materials/cost views, actual historical reconciliation,
original-browser/cloud backups, recovery rehearsal and production activation review remain
open. No actual project has been backed up, imported, restored or corrected by these tests.
