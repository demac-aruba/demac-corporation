# Projects release decision — 2026-09-21

The owner explicitly declined isolated staging: “no voy a hacer staging aislado”.
Remove creating/deploying/validating a separate staging environment from the requested
release conditions. Earlier documents that list it as a mandatory pending gate are
superseded on that point. This records a scope decision, not a claim that deployed
staging verification occurred or that emulator evidence proves live configuration.

No new product code or tests are required solely because of this decision. Current
shipping application remains cf7b141d; local final evidence/test-harness HEAD before
this documentation update is 2fcccd16. No unresolved actionable finding is known in
the agreed local implementation/review scope.

Remaining work:

1. Publish the prepared companion commit 530b7cb0 to #515 before the #514 continuation,
   update both PR descriptions to the delivered scope and run their required GitHub
   checks on the actual published heads. Local combined tests passed; remote checks
   still correspond to older code. On 2026-09-21 the remote heads remain a99402e (#514),
   3622bc5a (#515), and cb01c469 (main). No push was performed.
2. Preserve original browser Projects/templates and verify their canonical identities
   and relationships before real adoption/import, including the reported Matthijs case.
   Obtain authorized protected database/attachment backups and recovery evidence for
   the affected real operations. No original export, backup or real-data reconciliation
   has been certified. The original backup/restore conditions were not withdrawn by
   declining deployment staging; any change to those conditions must be explicit.
3. Prepare and approve the actual production release operations, including target
   configuration/flags/origins/indexes and coordinated backend/frontend/cache rollout.
   Main automatically triggers Office, Field, Work Order and WhatsApp deployments;
   WhatsApp also runs migration scripts. Existing Projects runtime/import flags remain
   off/closed. Merging alone does not activate the complete central Projects workflow.
   The owner's subsequent “ok entonces ya puedes hacer merge ?” authorizes publication
   and merge once the outstanding release conditions are satisfied. Publication to the
   existing PR branches is now proceeding. This does not certify missing backups or
   withdraw the original recovery/reconciliation conditions; no additional Projects
   activation, permissions/configuration change or manual data migration was requested.

## Publication authorization checkpoint

On 2026-09-21 the PRs were freshly confirmed open/draft, based on main cb01c469;
their heads remained a99402e (#514) and 3622bc5a (#515). Automatic effects were checked
again before publication: feature branches run PR checks and may create Vercel previews;
main changes trigger the production workflows described above, including WhatsApp data
migrations. The prepared companion 530b7cb0 was then published by a normal fast-forward
push to fix/projects-budget-soft-warning. Publish this documentation and the prepared
#514 continuation next, and inspect checks on both actual remote heads before merge.
Do not treat historical CI or local test results as current remote CI completion.

QuickBooks connectivity and future photo/audio/AI expense capture are not prerequisites.
There is no new general expense, accounting, payroll or Inventory implementation to finish
as part of this agreed operational scope. Do not restart the audit or rerun unchanged
local suites merely because the conversation resumed.
