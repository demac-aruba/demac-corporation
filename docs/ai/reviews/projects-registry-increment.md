# Projects registry increment — adversarial review

Mode: Solo Maintainer Adversarial Review. The implementation author also performed a
separate reject-oriented review; this is not an independent reviewer claim.

## Scope and intent

Review the dormant central planning service, exact identity linkage, existing Field schema
adapters, replay/version boundaries, estimate semantics, command validation, bounded reads,
new Auth/Firestore emulator suite, and isolation from production exports and mutations.
The owner requires the entire Projects integration to be complete before production merge;
this increment is NOT the entire module and no merge is permitted on its strength alone.

## Findings and changes

- Identity-conflicting Work Orders were filtered only after their Field children were read.
  Filter parents before fan-out; preserve a reconciliation issue and unavailable totals.
- Legacy aliases could contradict the canonical Customer identity inside Field and review
  records. Reject contradictory aliases instead of silently accepting one value.
- An unnecessary restriction initially denied estimate revision to Project Managers despite
  their existing projects.manage capability. Preserve the existing Projects role contract;
  an estimate revision still needs explicit reason, expected version and atomic history.
  Finance/Office/Technician writes remain denied. No production permissions were changed.
- Phase-history checks initially made one request per removed phase. Batch ten phase IDs
  with a bounded existence query instead; no full-collection fallback.
- A synthetic budget-overrun test used an unrealistically long single Work Order. Exercise
  the same over-budget rule with a normal six-hour order and a five-hour estimate instead;
  the pure arithmetic test separately covers 66 versus 70 hours. No booking rules are bypassed.

## Existing verified evidence

Before these hardening changes, CI run 35363221692 passed the real local Auth and Firestore
integration job on demo-demac-projects. Local domain/recovery tests passed 56/56 with zero
skips. PR #515's corrected browser harness passed Chromium and WebKit on commit 3622bc5.
Current-head results after hardening must be confirmed in CI and recorded in the PR.

The new service is disabled by default, has no HTTP/Function export and does not write to
clients, properties, appointments, workOrders, workVisits, capacity locks, Inventory or the
WhatsApp queue. Its tests explicitly inspect unchanged synthetic sentinel records in those
collections. Firestore's existing deny boundary also rejects direct client registry writes.
No production project or browser data was accessed, backed up or reconciled.

## Release decision: BLOCK whole-module release

Still missing: original browser backup, verified production backup/restore process, historical
import/identity preservation, rich planning/schema compatibility, actual UI transport and
automatic canonical booking handoff, measured-time and physical-progress sources, full-project
aggregate read model for paginated activity, and Materials/Expenses/Financial integration.
Real project PRJ-1013 is not repaired by this increment. Do not treat page totals or passed
emulator tests as proof of a complete operational Project. Keep the feature draft.
