# ERP Next — System Governance V1

## Settings
- SET-001 — Changeable business rules live in governed configuration, not hidden code.
- SET-002 — Scheduling durations and buffers are configurable.
- SET-003 — Work calendar, routing anchors and capacity are visible policy.
- SET-004 — Protected integrity controls require elevated permission.
- SET-005 — Configuration changes will be versioned and audited when persistence is connected.

## Automations
- AUT-001 — Every automation has a visible ID, trigger, action, owner and authority mode.
- AUT-002 — Automations may be enabled/disabled only through governed permissions.
- AUT-003 — Appointment reminders and maintenance follow-up are operational, consent-based communications.
- AUT-004 — Inventory replenishment and payment matching initially prepare suggestions instead of risky writes.
- AUT-005 — Complex/sensitive customer cases route automatically to humans with context.
- AUT-006 — High-risk financial/destructive actions remain explicit-approval only.

## Integrations
- INT-001 — Provider-specific logic is isolated behind adapters.
- INT-002 — Firebase, QuickBooks, Meta, OpenAI, banking and telephony expose visible health/configuration state.
- INT-003 — Production write capability remains disabled until each adapter is tested and approved.
- INT-004 — Secrets are server-side only and never stored in product documentation or browser code.
- INT-005 — Integration failures must surface in an actionable log/exception queue.

## Audit
- AUD-001 — Significant events identify actor, time, area, action, object and outcome.
- AUD-002 — Critical record changes preserve enough before/after context to investigate.
- AUD-003 — Security/approval events remain traceable.
- AUD-004 — Audit history must not be silently overwritten by ordinary users.

## Integration state
The current implementation is an interactive governance preview. Firebase-backed persistence, authentication, roles, audit writes and live integration health are the next infrastructure phase.
