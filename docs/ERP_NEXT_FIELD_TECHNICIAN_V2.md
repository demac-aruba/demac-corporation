# DEMAC ERP Next — Technician Field App V2

Status: In Development / mobile-first preview.

## Purpose

Give technicians a focused execution experience over the same canonical Work Order domain used by office operations. The Field App must minimize unnecessary taps and duplicate data entry while preserving complete asset-level evidence for office review.

## Requirements

### FIELD-001 — Technician sees only relevant work context
The Field App exposes the technician's assigned Work Orders, customer/site, equipment scope, technician-only instructions and relevant history. It does not expose the full office CRM or finance environment.

### FIELD-002 — Equipment is auto-loaded from the property
When a Work Order references registered HVAC assets, those assets are immediately available to the technician. There is no separate “Search A/C” requirement before work can begin.

### FIELD-003 — QR assists identification; it is not the only entry path
A QR can identify a registered asset quickly, but technicians can open equipment directly from the Work Order list when the correct asset is already known.

### FIELD-004 — One persistent intervention state per equipment asset
Condition, measurements, findings, work performed, evidence and completion status remain stored while the technician moves between steps. A validation error must not clear previous selections.

### FIELD-005 — Nameplate evidence is conditional
If the asset registry already contains verified plate identity, the Field App explains that a repeated plate photo is unnecessary. Missing/changed/corrected identity can request new plate evidence.

### FIELD-006 — Evidence capture does not lock other photo controls
Taking one photo must not disable unrelated evidence buttons. Each evidence requirement has independent state.

### FIELD-007 — Workflow evidence uses optimized thumbnails
The working UI uses lightweight thumbnails/preview state. Original evidence references remain available for office/report use without forcing full-resolution rendering in every technician screen.

### FIELD-008 — Refrigerant condition follows gauge-after evidence
The measurement/evidence workflow places post-service gauge evidence with the final technical assessment rather than collecting refrigerant condition too early.

### FIELD-009 — Voice note is optional and capped at two minutes
Technicians may attach a voice note up to 120 seconds. The UI clearly validates the duration before final submission.

### FIELD-010 — Transcription does not block allowed field work
After secure upload, transcription can be queued/processed asynchronously while the technician continues other permitted workflow steps.

### FIELD-011 — Materials and add-ons are reviewed before report submission
Armaflex, brackets, switches, refrigerant and other additions remain inside the field workflow before the technician submits for office review.

### FIELD-012 — Recommendation does not automatically become a charge
A technician recommendation can feed CRM Opportunities or office review, but it is not automatically billed unless acceptance/pricing rules make it a billable installed add-on.

### FIELD-013 — Original technician report is preserved
Written notes, audio and per-equipment evidence remain the original field source. AI professionalization is a separate downstream representation.

### FIELD-014 — Field completion does not send to the customer
Completing field work submits structured results to AI processing/office review. Customer delivery remains controlled by the office.

### FIELD-015 — Field App and office Work Order share the same source of truth
The Field App does not create a second technician-specific Work Order schema. Office and field surfaces use the same canonical identifiers and lifecycle contracts.

## V2 preview implementation

- Dedicated `/field` route and Field App navigation entry for super-admin preview / technician role.
- Mobile-first Work Order header with schedule, van and internal instructions.
- Simple five-stage technician workflow: Job → A/C Units → Add-ons → Report → Done.
- Equipment auto-load from canonical property context.
- Asset intervention screen with persistent condition, evidence, voltage/pressure, refrigerant condition, findings and work performed.
- Independent before / gauge-after / after photo state.
- Conditional nameplate instruction.
- Materials/add-ons review state persists when returning to the report.
- Voice-note preview with 120-second validation and asynchronous transcription state.
- Completion screen clearly separates AI processing, office review and unsent customer delivery.

## Next Field checkpoints

1. Real camera/image-picker adapter and thumbnail generation.
2. QR scanning adapter and asset-resolution errors.
3. Configurable intervention templates by work type/equipment class.
4. Measurement validation/ranges and required-field policy.
5. Offline/local draft persistence and retry-safe uploads.
6. Firebase/server adapter for Work Order execution and assignment authorization.
7. OpenAI transcription/background job integration.
8. Real inventory/add-on workflow and price/acceptance permissions.
9. Technician authentication/role shell optimized for Field App rather than office navigation.
10. Acceptance tests for state persistence, photo independence, nameplate conditions and no-auto-send behavior.

## Deferred decisions

- exact required measurements for every HVAC system/work type
- final offline synchronization conflict policy
- which technician actions require supervisor override
- final camera compression/thumbnail dimensions
- exact QR label format
