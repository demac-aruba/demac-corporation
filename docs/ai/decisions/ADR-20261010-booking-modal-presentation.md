# ADR-20261010: Preserve Booking authorities while changing presentation

- Status: Accepted for owner-approved implementation, subject to release gates
- Date: 2026-10-10
- Owners: Scheduling / Operations
- Related task: ../tasks/booking-centered-modal-20261010.md
- Supersedes: none

## Precedence rule

This presentation decision does not supersede any Booking, CRM, Project, reference or communication authority decision. Later approved ADRs may supersede it explicitly.

## Context

The approved design replaces the long Scheduling booking drawer with a centered workspace. All existing booking features and production data must remain compatible.

## Decision

Retain the original state, domain handlers, payloads, capabilities and authoritative adapters. Reorganize their JSX into desktop columns and responsive mobile flow. Keep stateful contact/reference editors mounted behind native details. Keep coworker support as its existing independent workflow, with matching modal presentation. A scoped hook owns modal focus and dismissal; existing child dialogs retain their lifecycle. Pending operations/recovery prevent parent close. No new source of truth, dependency, migration or backend change.

## Alternatives considered

| Alternative | Benefit | Cost/risk | Decision |
| --- | --- | --- | --- |
| Rewrite booking as a new form | Complete layout freedom | Duplicated state/commands and missing conditional features | Rejected |
| Unmount inactive tabs or wizard steps | Less visible content | Lost child drafts/upload ownership and hidden validation | Rejected |
| Keep original components in columns/details | Preserves workflow and permits compact overview | Dense desktop content still needs some scrolling; mobile stacks | Selected |

## Consequences

- Booking Authority remains the final capacity/commit authority. Contacts and property edits keep their governed save paths.
- Opening Booking may perform the existing offer validation operations; layout/disclosure/focus changes introduce no business writes. Confirm/hold/master actions retain their explicit behavior.
- Security, communication, billing and Field boundaries are unchanged.
- The form still scrolls on small screens or when many optional fields are expanded; fixed actions remain accessible.
- No data migration; frontend deployment is reversible without undoing customer activity.

## Verification and rollout

See task and independent review. Require types, build, real-component synthetic browser scenarios, authority/lifecycle/project/communication regression and existing CI before merge. Publish only the verified live frontend project and verify its exact revision/assets. Keep prior ready deployment available for rollback. Revisit if future changes introduce tabs, unmount fields, change writes or alter nested dialog ownership.

## Approved follow-up — 2026-10-10

The owner requested three-way Regular / Project / Support navigation and more catalog space.
The same session now keeps the regular/Project and support drafts mounted, while only the
visible dialog owns focus/Escape/scroll. Returning from support to the same booking source
retains its draft; changing Regular↔Project still uses the existing source reset rules.
Support unknown outcomes lock navigation until the original idempotent command is recovered.
Work summary, customer/technician descriptions and visit references move to the right column.
Capacity is a compact footer status with its existing complete controls inside expandable
details; actionable support/overtime decisions open those details automatically. This is a
presentation/session-lifetime change only; all canonical authorities and payloads remain.
See `docs/ai/tasks/booking-modal-followup-20261010.md` and its separate review for evidence.
