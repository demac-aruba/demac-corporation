# Task: Settings-activated visual editorial workspace

## Context and authority

Owner Christian approved implementation after the editable-VRF mockup. Issue #512
records the binding content-only scope. PR #513 is **preview only**. This is Deep
Review because authenticated write paths, concurrency and publication recovery are
involved. No production deployment, activation, rules rollout, data migration or merge
is authorized. The preview is functional but deliberately uses tab-local review storage.

## Evidence before implementation

- Website Manager owns existing VRF drafts in `businessSettings/publicVrfPageDraft`;
  public content comes from `public-website/vrf/published.json` in Storage. Its Firestore
  published document is an audit/manager projection, not the public rendering authority.
- The legacy save helper returns a local-only snapshot after Firestore failure, making
  a generic saved message ambiguous. The visual editor must not reuse that ambiguity.
- VRF is statically exported. Existing server-side content loading happens at build;
  public clients need an explicit same-source published-content refresh for content-only
  publication without changing source code. Failed refresh retains valid rendered content.
- Some VRF media lived in presentation constants. Those exact values now belong to the
  shared content defaults. No replacement artwork, invented copy or new layout is approved.
- `businessSettings` was generally readable by active staff and writable by operations.
  VRF drafts/receipts require a narrower boundary. Rule changes are staged, not deployed.

## Scope

The actual VRF renderer is shared between public visitors and the editing iframe.
Settings creates a one-use source-window-bound launch; a normal signed-in visit has no
editor UI. The tab may navigate normally. Only VRF is connected in this first release;
Careers and other routes remain view-only. Links/actions/forms/styles/layout and all
operational ERP data remain outside the editorial allowlist.

## Acceptance criteria

- Normal anonymous and authenticated visits have no edit controls; direct editor URL
  and arbitrary `?edit=1` do not activate a session.
- Only provisioned active owners can launch, save, upload, publish or recover. Session
  logout/revocation removes editor capability. No auth token is passed in URLs/messages.
- Desktop/mobile use the same content and real components. Tabs, accordions and site
  navigation still work. Content navigator reaches hidden tab/disclosure content.
- Selecting text/images opens a content-only panel. Images are decoded before use.
- Draft saves, review publication, undo and history work in preview without cloud writes.
  Tab-local review saving is labelled differently from cloud saving.
- Live service uses exact field allowlists, optimistic revisions, protected-field
  preservation and request-bound generation-conditional publication with read-back.
- Lost responses, concurrent retries and stale writers never silently overwrite a
  newer draft/publication. Reset/recovery actions are explicit.
- New commercial pages must integrate this shared editor after their design/content
  approval. Do not add a separate administration screen for each page.

## Exclusions and safety

No operational writes or scheduling-policy changes. A necessary read-only compatibility
change makes the canonical operations loader GET `businessSettings/business-calendar`
instead of listing the entire collection, which now contains private editorial drafts.
The returned calendar and the missing-calendar default are unchanged. A focused test
checks exact read scope, retained data and error propagation. Auth changes emit an editor-only, credential-free
logout signal; other ERP tabs are not signed out by that signal. Native form submission
from editing frames is blocked; regular public visitors are unaffected. No live forms
are submitted during tests. Shared header/footer editing is not included in the VRF
pilot: future global content editing requires explicit scope review and warnings.

## Verification plan

Pure contract/service tests cover prohibited fields, roles, activation, shared drafts,
concurrent edits, idempotency, lost-response recovery, stale publication, reset and
historical restore. Actual rules run against localhost demo Firestore/Storage emulators.
Actual exported pages run in Chromium/WebKit with test-only localhost auth responses,
no cloud mutation requests, desktop/phone screenshots and negative activation tests.
Existing VRF indoor/mobile acceptance and ERP build/CI remain enabled.

Results are recorded separately in REVIEW.md and PR checks; planned tests are not passed
until their runs and artifacts are inspected.
