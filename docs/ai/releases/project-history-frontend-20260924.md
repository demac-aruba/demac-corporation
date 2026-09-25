# Projects historical slot correction: frontend release

This documentation-only change triggers the normal production frontend builds for
the already-reviewed Projects historical slot correction merged in PR #528
(`5b0d6d1519ef70e1c37fa2252c7cdfd93966f06c`). The merge commit used
`[merge-only]`, which deliberately skipped Vercel production builds. No runtime
code or data changes are introduced by this release trigger.

The approved backend was deployed separately by the guarded
`release/project-historical-bookings` workflow run 36008120877. That workflow
passed its historical acceptance and deployment checks. This frontend release
does not deploy Firebase Functions or modify customer, appointment, technician,
or accounting records.

After Vercel completes, verify both production projects have a READY deployment
for this release commit and confirm the Projects page loads. Technician actual
hours, completed work, and invoicing remain outside the slot-correction scope.
