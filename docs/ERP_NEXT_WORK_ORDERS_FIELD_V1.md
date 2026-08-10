# DEMAC ERP Next — Work Orders & Field Operations V1

Status: In Development / preview and domain foundation.

## Purpose

Separate scheduling from execution. An Appointment reserves time/capacity; a Work Order owns what must be executed, by whom, on which customer/site/assets, with what evidence/materials, and what happens after the technician finishes.

## Requirements

### WO-001 — Appointment and Work Order are separate entities
An appointment controls date/time and customer scheduling state. A Work Order controls execution scope, assignments, equipment, evidence, field results, materials, report and review. Either may reference the other without becoming the same record.

### WO-002 — One Work Order may have multiple assignments
Primary and support vans/teams can execute one Work Order. A 10-unit same-site job therefore remains one customer job with multiple assignments rather than duplicated customer/work records.

### WO-003 — Only one assignment owns customer communication
The primary assignment is the customer-communication owner. Support assignments never send duplicate confirmations, reminders or completion messages.

### WO-004 — Equipment scope uses canonical Site assets
Technicians receive the selected HVAC assets already registered for the customer/site. The workflow must not require a separate “search air conditioner” action when canonical asset context already exists.

### WO-005 — Results are recorded per equipment asset
Each selected HVAC asset receives its own intervention result, findings, actions, measurements and evidence references. This history follows the durable asset rather than a calendar event.

### WO-006 — Evidence can be Work Order- or asset-specific
Before/after photos, gauge evidence, installation evidence, findings and other media may reference the overall Work Order or a specific HVAC asset.

### WO-007 — Voice note maximum is 120 seconds
Technician voice notes are limited to two minutes. The UI warns or blocks when the recorded duration exceeds the configured maximum.

### WO-008 — Transcription may continue asynchronously
Voice/audio upload and transcription states are separate. Once upload is secure, transcription and AI professionalization may continue while the technician progresses through permitted workflow steps.

### WO-009 — Technician completion does not auto-send a report
Completing field work may submit the technician report and trigger AI processing, but it never automatically sends a report to the customer.

### WO-010 — Office review controls customer delivery
The office reviews/edits the professional report, approves it, and then explicitly chooses a customer delivery channel such as WhatsApp or email.

### WO-011 — Original and professionalized reports are both retained
The technician's original written/audio evidence is preserved. AI creates a separate professionalized draft rather than overwriting the original report.

### WO-012 — Multilingual outputs are separate reviewable artifacts
Report outputs support Spanish, Papiamento Aruba and English. Translation/professionalization status is visible to the reviewer and each output remains reviewable.

### WO-013 — Materials and add-ons become downstream transaction inputs
Materials, measured consumables and accepted/installed add-ons are captured before submission. Later Inventory and Finance adapters use these records to create inventory consumption, invoice lines, margins and commissions without re-entering field data.

### WO-014 — Technician form state must survive validation failures
If submission is blocked because a required result is missing, already entered equipment conditions, measurements, findings, materials, add-ons and notes must remain intact.

### WO-015 — Technician completion, office review and closure are distinct lifecycle states
The Work Order lifecycle explicitly distinguishes field completion, office review and final closure. Closing is not implied merely because technicians stopped working on site.

### WO-016 — Operational history is append-only/auditable
Lifecycle transitions, assignment changes, report submission, office approval, delivery and later corrections should create auditable history events rather than silently rewriting prior business facts.

### WO-017 — Nameplate evidence is not redundantly required
If equipment registration already contains verified nameplate identity, the technician is not required to photograph the same plate at every visit. New nameplate evidence is requested when identity is missing, changed or being corrected.

### WO-018 — Customer-facing reports are concise
The professional report shown/sent to a customer should be concise and useful. Full technical evidence remains available internally without forcing every customer report to become a long engineering document.

### WO-019 — Field evidence thumbnails are optimized for workflow
Technician/office workflow may use low-resolution thumbnails for speed while retaining references to original evidence files where needed.

### WO-020 — Office edits do not alter technical evidence
Editing the professional report changes presentation/wording only. Measurements, source photos, original technician notes and recorded field findings remain separately traceable.

## V1 preview implementation

- Dedicated `/work-orders` premium command center.
- Work queue with readiness and lifecycle status.
- Work Order 360 header and stepper: Scheduled → En route → On site → Working → Tech complete → Office review → Closed.
- Multiple assignment presentation including primary/support example.
- Equipment scope and per-asset intervention completion.
- Explicit nameplate-recapture rule.
- Field Report with written technician notes and 2-minute voice validation.
- Submission gate requiring equipment results and materials/add-ons review.
- Materials and add-ons workspace.
- Evidence library preview.
- Office Review side-by-side original/professional report with Spanish/Papiamento Aruba/English output states.
- Approval explicitly leaves customer delivery as a separate manual action.
- Append-only history preview and Work Intelligence side rail.

## Next Work Order checkpoints

1. Equipment-intervention editor for condition, measurements, findings, actions and evidence.
2. Real field-report state machine and background AI/transcription job contract.
3. Inventory reservation/consumption adapter contract.
4. Add-on acceptance/pricing/invoice-line contract.
5. Technician-focused mobile/PWA execution surface using the same canonical Work Order domain.
6. Office review editing/version history and report-output generation.
7. Role/capability enforcement for technician vs office vs supervisor.
8. Firebase persistence/concurrency and migration mapping from Legacy field data.
9. Acceptance tests for support vans, incomplete reports, voice duration, asset persistence and no-auto-send behavior.

## Deferred decisions

- exact mandatory measurements by equipment/system/work type
- final photo/evidence requirements by work preset
- final QR label format and printing workflow
- customer report layout/PDF brand template
- whether selected low-risk report translations can eventually auto-approve after measured quality thresholds
