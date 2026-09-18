# Visual editor release state — 2026-09-18

## Current delivery is an isolated review, not live publishing

PR #513 implements the shared visual editor with VRF as the first page. It remains
unmerged. A normal public visit has no edit UI, even for a signed-in administrator.
Activation starts from Settings / Website Manager in a separate editing tab.

Preview drafts, file uploads, history and Publish preview live only in that editing
tab. They do not modify Firebase. Closing/reloading the tab loses review-only state.
The UI must label this explicitly; do not describe review saving as cloud saving.

## Merge and deployment isolation

The production root `firestore.rules`, `storage.rules`, `firebase.json`, Firebase
rules deployment workflow and operational `functions/bootstrap.js` are unchanged.
The previous Legacy/calendar read compatibility changes and legacy patcher changes
were withdrawn: those files equal the PR base. CI compares these exact paths and
runs the retained readers to catch behavioral regressions.

Candidate editor rules moved to `functions/website-editor-review/` and are referenced
only by `website-editor.emulator.json`. All original rule allow/deny checks remain
mandatory against these candidate fixtures. No production deploy workflow or required
check was disabled. Root rules will not auto-deploy merely because this PR merges.
The inactive website-only API uses the same isolated Firebase adapter as the new
persistence integration tests; it is not exported from the operational bootstrap.

Production builds still default to editor-disabled. Merging code alone does NOT enable
live editing and must never be presented as the completed production feature.

## Before live activation (not executed)

1. Close technical findings and obtain owner approval of the functional preview and
   the explicit website-publishing rollout scope. User approval to continue coding is
   not authorization to change production permissions or fabricate test content there.
2. Reconcile current draft/published content and Storage generation; no resets to defaults.
3. Prepare a dedicated website publisher deployment without redeploying operational
   functions. Verify exact authorized origins and identity checks. Never wildcard all
   preview hosts into the production write endpoint.
4. Review fresh production rules. The candidate fixtures are snapshots, not a command
   to replace current root rules. Existing collection-wide businessSettings readers
   must be addressed before restricting access to the canonical draft documents.
   That compatibility rollout is deliberately absent from this frontend review.
5. Coordinate endpoint, permission boundary and UI activation with explicit gates and
   recovery checks. Old and new publishers must not concurrently overwrite one another.
6. Verify one owner-approved editorial change through the real authenticated endpoint,
   then an anonymous read of the public page and the approved recovery procedure.
   Emulator persistence is additional evidence, not proof of production activation.

## Failure / recovery

Cloud failure remains a visible error; it must not become a cloud-looking local save.
Uncertain publication retries preserve request ID and revision. Never delete a pending
receipt to hide ambiguity. Reconcile the public content/digest first. Reset and restore
create drafts only. Production rollback preserves content, drafts, history and media.

Static HTML/metadata still represents the last code build. The current published JSON
is refreshed after hydration. Any later HTML/SEO revalidation change must be documented
and validated separately, not hidden as a side effect of Publish.
