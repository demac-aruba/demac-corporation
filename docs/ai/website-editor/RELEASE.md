# Visual editor rollout checklist (not executed)

## Preview

- PR #513 remains separate from main. Existing deployed site is unchanged.
- Sign in as owner on the preview host, open Settings / Website Manager and click
  Edit Front End. Direct editor links intentionally do not activate editing.
- Test text selection, decoded image replacement, phone/Desktop preview, tab navigation,
  Careers exclusion, draft saving, review publication, version recovery and Exit.
- Review drafts/uploads/publication exist only in that editing tab, not cloud/production.

## Required before production activation

1. Obtain owner approval for the final code diff and separately for backend/rule rollout.
2. Close Deep Review findings; pass actual typecheck/build, UI and emulator allow/deny gates.
3. Confirm exact production ERP/web origins and add only them to the API CORS allowlist.
   No wildcard `.vercel.app` origin and no preview access to live publishing.
4. Deploy the function with activation off. Deploy and validate scoped rules while the
   legacy owner writer is still available. Verify all active clients use scoped reads for
   `businessSettings` (including Legacy consumers) before restricting collection reads;
   ERP Next calendar loading now reads only the required `business-calendar` document. Do not deploy unrelated functions or settings.
5. Read/snapshot existing canonical draft, published audit and Storage generation; compare
   operator copy. No destructive migration or silent replacement with defaults.
6. Set the governed activation only through an authorized server/deployment operation;
   clients cannot write `businessSettings/website-editor`. Confirm direct old VRF write
   paths are denied and owner reads/public snapshot reads still work.
7. Enable the production UI flag, retire the duplicate VRF manager writer in that mode,
   and exercise one explicitly approved editorial change and recovery end-to-end.
8. Verify the public client receives the expected publication ID/content, without a
   privileged session. Do not infer publication merely from the saved Firestore audit.

Backend environment flag, configuration gate and frontend flag must be coordinated; the
implementation assistant has not set them. This staged rollout keeps the preview from
mutating real content and avoids mixing old/new publishers.

## Failure and rollback

- Cloud save denial must remain an error, never silently become a cloud-looking local save.
- Uncertain publication: reload/retry the original request ID; verify generation/digest.
- Stale draft: reload or explicitly reset to current published content; review edits again.
- Never delete a pending receipt to hide an error. Reconcile public bytes first.
- To return to legacy writing, first resolve pending publications, confirm a valid public
  snapshot, then coordinate feature/config flags and scoped rules with owner approval.
- Preserve all draft/history/media. No production data deletion is part of rollback.
