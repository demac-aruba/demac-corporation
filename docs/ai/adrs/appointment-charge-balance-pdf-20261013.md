# ADR: actual-work balance preview and confirmed operational PDF

- Status: Accepted, implementation approved by Christian on 2026-10-13; release gated by review.
- Owners: DEMAC Operations / Finance.
- Refines OPS-SCHED-CHARGES-001/002 and appointment-operational-charges-20261010.

## Decision
Booking projections are informational and never supply an actual-work balance. During
editing, a current complete server quote minus persisted receipts is explicitly an
estimated balance. Loading, failed, stale or unreconciled quotes show no balance. Outside
editing, only a confirmed final snapshot supplies the pending/credit balance. No confirmed
total means pending, including old appointments with recorded deposits and no projection.
Editing never promotes a draft's zero balance to a saved paid state.

The PDF is a local document projection of a fresh authorized `get_appointment_charges`
transaction. It exports confirmed lines and receipts, checks their sums, identifies the
appointment and snapshot version, marks voided receipts and labels itself an operational
summary, not an official invoice. It creates no number, tax, invoice, payment, upload or
QBO transaction. Reader access suffices; acquiring a writer lease is unnecessary. Failed
reads and reconciliation blockers prevent download. Leaving the view discards late results.

## Consequences and alternatives
- Preserves all existing snapshots, financial versions, lease fencing, exact retries,
  Field reconciliation, mandatory reasons, scope acknowledgment and receipt audit.
- An estimate-only balance was rejected because it conflicts with actual-work entry.
- Exporting the displayed draft was rejected because it would imply confirmation.
- PDF uses standard PDF font references like the existing payroll exporter,
  with deterministic body metrics, pagination, escaped data and no external resources.
  Latin/WinAnsi text is rendered directly; unsupported code points are retained visibly
  as `[U+XXXX]`, rather than silently discarded. No generated document is stored remotely.
- PDF code loads only on explicit download; typing retains one catalog load and local search.
- Success notifications expire after 4.5 seconds; financial errors and uncertain outcomes
  remain persistent. Success is shown only after the authority acknowledges a commit.

## Verification and recovery
Focused domain, balance/PDF, real component/authority transactional flows and responsive
browser gates precede review, merge and production publication. No migration, backend,
security rules, configuration or customer communication change. Roll back the frontend
deployment if needed; retain receipts and final snapshots saved during the release.
Review again before official invoice issuance, tax or automated customer delivery.
