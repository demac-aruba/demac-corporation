# Projects legacy import increment — dormant, not a production migration

## Request and current boundary

Christian asked to continue until Projects is complete, clean, efficient and safe to merge.
The whole-module readiness condition is not met. Development continues on PR #514 only;
PR #515 remains the separately tested advisory-budget correction. Neither PR is merged.

This increment fills the identity-preserving planning import gap. It does NOT connect the
active Projects screen to the registry, export an HTTP endpoint, activate new collections,
move production records, repair the reported project, or calculate Field actual hours.
No production database, client browser storage or session was accessed in implementation.

## Implemented

- Verified-backup selector extracts one unambiguous original Project. It never enumerates
  authentication keys, writes local storage, uploads or truncates an oversized source.
- Rich planning compatibility preserves original project/phase IDs and project numbers,
  instructions, objective/exclusions, priority, dates, prerequisite graph, planned units,
  checklist requirement flags, captured manager/contact snapshots, originating slot budget
  and optional AWG material estimate. Partial metadata edits preserve untouched details.
- A deterministic converter keeps the original selected JSON as a private recovery archive.
  Unknown fields, financial history, local assignment links and simulated completion remain
  in that archive; they are not promoted into canonical execution, inventory or billing.
- `preview_legacy_import` performs bounded read-only checks of identity, unique number,
  existing archive/history and CRM references. Its fingerprint includes exact Firestore
  update-time seconds and nanoseconds. Source changes invalidate the prior approval.
- `import_legacy_plan` uses the existing registry transaction, role/activation checks and
  receipt/audit path. It creates plan + unique number + source archive + event + receipt
  atomically. It cannot overwrite an existing ID or number, or silently attach bookings.
- Only the provisioned active owner may preview/import/read archived source. Applying an
  import additionally requires `allowLegacyImport=true` AND server-side
  `businessSettings/projects-registry.legacyImportEnabled=true`. Both default off. The
  existing registry runtime and `backendEnabled` gates also remain required.
- The exact preview warnings and verified-backup declaration are required on apply. The
  declaration is the operator's attestation, NOT proof that the browser saved a file or
  that Firestore backup/restore was exercised. Checksums provide integrity, not authenticity.
- Imported planning starts `pending_reconciliation`. A local declaration of Active, Near
  Completion or Completed is preserved as source evidence; it does not certify Field
  execution. Project allocation totals remain unknown until historical reconciliation.
- `get_import_source` retrieves the checksum-validated original selected record without
  restoring or overwriting any current record. This is a recovery read, not automatic restore.
- Project/budget revision overflow now rejects instead of creating an unreadable version.

## Authority and data handling

The proposed `projectLegacyImports` collection is an append-only source archive for the
future approved migration, not a second Work Order/Customer/Property/accounting authority.
No direct client rule or deployment export is introduced. Authenticated server checks and
unchanged Firestore rules are tested separately. No raw source JSON is written to logs or
CI evidence. Full saved backup files remain external to the registry and must be retained
privately; selected-record archives do not replace the full backup or company templates.

A source budget is the baseline captured in the backup, not a reconstruction of its entire
past revision history. Original and revised central estimates remain separate thereafter.
Bookings above an estimate continue to be advisory; an import must not manufacture actual
hours or physical completion from slots. Cash amounts are retained in integer minor units;
planned Van minutes and actual person-minutes must not be combined as interchangeable units.

## Verification

Local partial exact-source workspace on Node 22.16.0: 76 dependency-free tests pass,
0 failed and 0 skipped; runtime syntax and diff whitespace checks pass. The original 56
recovery/domain tests remain, with 20 import/compatibility checks added. These results are
not production or real-browser evidence.

New guarded Auth/Firestore tests exercise preview/no writes, owner/activation denials,
concurrent exact replay, conflicting identities/numbers, changed CRM/source versions,
partial-write rollback on audit failure, immutable original source retrieval, corrupted
archive rejection, direct-client rule denial, metadata compatibility and revision limits.
Those tests run after the existing registry emulator suite in a loopback demo project only.
CI results must be checked on the published head before claiming they passed.

A second CI job integrates pinned PR #515 commit
`3622bc5a4871b6ce7019af02f7354a5cc23171ee` only in a disposable runner, then executes both
Projects contracts and existing Booking/Field/ERP gates. It has read-only GitHub permissions,
no push/PR merge/deployment command and no production credentials. This tests code compatibility;
it is not a release or proof of live historical-data reconciliation.

The temporary successful scoped-source archive job was removed after exact source was
obtained. No product validation gate was removed or weakened. Previous archive path failure
was fixed and rerun, not waived. No code-generation patch chain ships with this increment.

## Remaining whole-module release blockers

1. Obtain the original verified browser backup AND verify cloud backup/restore separately.
2. Reconcile the reported project with actual appointments/Work Orders/Field evidence.
3. Complete migration review UI, shared project UI and company-template compatibility.
4. Complete atomic/repairable Booking Authority handoff; no browser-only post-confirmation link.
5. Connect measured Field time/phase progress and existing Inventory/Finance cost sources.
6. Validate integrated desktop/mobile workflows, final joint regression, staging recovery
   rehearsal and activation/deployment scope before requesting the final production decision.

Keep main unchanged. If a future release is rolled back, first stop registry/import writes,
retain source archives and audit, restore the prior code, and reconcile any new activity.
Never restore a whole old database over newly created real bookings. A selective restore
procedure still requires implementation and rehearsal; this increment does not claim it exists.
