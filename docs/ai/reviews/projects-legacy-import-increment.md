# Review: identity-preserving Projects planning import

## Mode and scope

Solo Maintainer Adversarial Review. Author and reviewer: ChatGPT, separate review pass;
not independent. Reviewed request, original Projects shapes, registry domain/service,
legacy conversion, archive read, activity coverage, input/version/role checks, complete
new unit/emulator tests and CI integration with the pinned budget fix.

## Findings and actions

- Rich planning fields were absent from the initial registry contract. Added validated
  optional details and required/optional checklist flags without changing existing records.
  Actual/completed local values are archived and not accepted as authoritative Field state.
- An imported project with no central links could look like zero planned work. Added an
  explicit pending-reconciliation coverage issue; project totals remain unavailable.
- Initial source budget might be misrepresented as all historical original revisions.
  Recorded captured-baseline-only provenance and an explicit preview warning.
- Command version increment at MAX_SAFE_INTEGER-1 could create a record the next read rejects.
  Added bounded advance guards, including the independent budget revision counter.
- Generic metadata replacement could discard untouched details. Added field-preserving
  detail patches; originating slot snapshot cannot be rewritten by a metadata command.
- Partial migration writes could leave a plan without recovery evidence. All import records,
  number ownership, original-source archive, audit and retry receipt share the transaction.
- Same project number with another case/identity, orphan links/history and changed CRM source
  must not be silently accepted. Preview reports conflicts; apply fails closed and tests
  challenge both concurrent actors and exact retries.

## Verified locally

76/76 dependency-free tests pass, zero skipped. JS syntax/diff checks pass. Source is a
verified Git archive of the scoped review files, not a full local ERP checkout. No real
Firebase emulator ran in this local workspace. CI must supply that evidence and the joint
PR #515/Booking/Field/ERP result. Initial current-head evidence is recorded in PR comments
once jobs finish; documentation never pre-fills a green result for unexecuted CI.

## Residual risks / release decision

BLOCK whole-module release. Real backup/reconciliation, production retention/index/access
verification for the archive, full migration UI, shared Projects UI, automatic Booking handoff,
measured actual time, physical progress, costs and staging restore rehearsal remain open.
No endpoint/deployment export or production flag is changed. No production record is read,
written, migrated or deleted. Audit/receipt and original source are preserved; no destructive
rollback command is included. A recovered source JSON is not a verified restoration of a
live database, and a checksum or backup-confirmation checkbox must never be sold as one.

Code compatibility tests do not guarantee zero future defects. Joint tests must be repeated
on the actual final release combination; the pinned budget-fix SHA is explicit and cannot
silently track an evolving branch. Keep both PRs draft until their relevant gates and the
owner's whole-module readiness conditions are satisfied.
