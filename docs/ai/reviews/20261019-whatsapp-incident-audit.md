# WhatsApp incident audit — 19 October 2026

## Task and scope

Owner requested diagnosis of missing appointment confirmations and today's technician schedules.
Deep Review, read-only production investigation. ERP: demac-aruba.com/scheduling; Firebase: demac-corporation.
Baseline main: dccb8b43772a03714acb90db61d34cbd25bbca63. Vercel production source observed: db79c60d83c45ee7de173104f0756db9f7e4f3e5.

Authorities: Booking Authority owns appointments; existing Communication Authority and whatsappOutboundQueue own outbound delivery. No alternate sender or queue. No deploy, message send, retry, data mutation, secret change or access-policy change is part of this audit.

Acceptance: establish producer/queue/transport boundary with bounded runtime metadata; distinguish proven code behavior from incident cause; record unavailable evidence explicitly.

## Source findings and baseline verification

- Existing six focused notification/transport test files: 75 tests passed, zero failed, local Node 24.19.0 (package production target Node 22).
- Isolated simulation: technician daily batch marked complete exits before any outbound delivery reconciliation at later recovery ticks.
- Isolated simulation: first failed acknowledgement for a normal text becomes terminal failed; only reference bundles get automatic retry here.
- Isolated simulation: internal same-day technician notification failure aborts the shared Work Order trigger before customer confirmation is attempted. Trigger does not explicitly enable retry.
- Authenticated ERP observation: a confirmed appointment dated 19 October has automatic confirmation enabled and state En cola. Another appointment shows a historical sent confirmation. Four configured Van groups appear ready. These observations do not establish current scheduler or bridge health.
- Vercel logs returned no matching warnings/errors for the requested morning; notification workers execute in Firebase, so this does not certify delivery.
- The latest inspected 13 October WhatsApp CI runs passed validation but skipped their deployment jobs. Do not equate these runs with deployed runtime source.

## Read-only diagnostic implementation

The incident branch adds only this report, a bounded diagnostic, and a branch-only GitHub Actions workflow. It reuses the repository's established Firebase and restricted SSH authentication patterns. It reads date-bounded queue metadata, three daily batches, canonical Scheduler configuration, four function revisions, at most 80 error logs, and selected local bridge health fields. No message body, recipient, credentials, raw logs or customer record is output. Query limits and truncation flags remain explicit. Per-section read failures remain visible and do not suppress independent checks.

## Separate Solo Maintainer Adversarial Review

Mode: Solo Maintainer Adversarial Review, not independent review.
Reviewed: complete new workflow/script, affected authentication boundaries, output fields and read-only commands.
The workflow cannot deploy and cannot trigger any sender. All Firestore calls are reads. Cloud commands are describe/read. SSH executes service status and localhost GET /health only. Output errors are categorized rather than echoed. No production credentials are copied outside the existing ephemeral runner authentication flow.
Residual risk: unavailable IAM or SSH rights may leave a diagnostic section unverified; local source may differ from deployed functions. No production repair is asserted before runtime evidence.

Runtime results: pending the branch-only read-only audit.
