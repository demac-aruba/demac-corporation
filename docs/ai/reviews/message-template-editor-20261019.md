# Review: Message template editor

## Review mode and scope

**Solo Maintainer Adversarial Review** — Codex is both implementation author and
reviewer in separate passes. This is not an independent review or production approval.
Reviewed the complete `feature/message-template-editor` diff against main
`78f7ac5ef86897defaf0706a78f2f0209248cb8c`, all three direct transactional queue
callers, technician reference-update routing, Task Tracker producers, principal role
mapping, existing Firestore default-deny behavior and System navigation.

## Findings corrected

| Severity | Finding | Correction / evidence |
| --- | --- | --- |
| High | Clearing an uncertain request after permission loss could discard evidence of an earlier successful save. | Preserve its exact request identity through auth denial/refresh; UI browser test retries the original receipt and remains at version 4. |
| Medium | Unreadable recovery storage blocked an internal flag without visibly locking the editor. | Explicit recovery-blocked state disables editing/saving; browser test verifies it. |
| Medium | Malformed stored copy could look like invalid new input and erase pending recovery state. | Server maps all saved-record corruption to `invalid-saved-template`; negative service tests cover schema and field corruption. |
| Medium | Weak success-response validation could clear recovery for incomplete/wrong records. | Validate catalog completeness/unique keys, selected identity, committed revision and exact saved fields before acknowledging success. |
| Medium | Task reminder greeting remained embedded in its generated deadline paragraph. | Move it to the editable field with controlled inline composition, preserving default wording; producer and preview tests verify replacement. |
| Low | Task daily messages could use a generic or stale name when a custom placeholder was added. | Pass the resolved current contact name through the daily item/closing renderers. |
| Low | The three-column layout could become cramped beside the real 264px ERP sidebar. | Collapse at 1380px; browser checks use the ERP sidebar width and five viewport widths. |

## Verification

- Node 22 focused/transitive backend suite: **171 tests, 171 passed, zero failures or
  skips**, covering saved configuration, admin denial, revoked token verification,
  transaction-time role revocation, duplicate request replay, stale revisions,
  restoration history, corrupt/unavailable config fallback, all 14 message variants,
  original customer address lines, unchanged attachment captions/order, existing
  queue immutability and Meta-template isolation. Task domain/queue policy and
  reference-bundle suites are included.
- Existing transactional suite before the added feature tests: **136/136 passed**;
  the new `messageCopy.test.js` is now included in its persistent npm test command.
- `npm run validate:firebase --prefix functions`: passed, including required
  prevalidation tests. New modules are included in syntax validation.
- `npm run typecheck --prefix apps/erp-next`: passed.
- `npm run build --prefix apps/erp-next`: passed, including existing prebuild
  acceptance gates and static `/settings/messages` generation.
- Browser exercised the actual React editor and shared composer, using only a
  synthetic API: live preview, independent language drafts, placeholders, invalid
  inputs, save/history/restore, lost response after commit, permission loss, refresh
  recovery, technician/task changes, catalog search and corrupt recovery lock.
- Browser editing/save passed at 390px; horizontal overflow checks passed at
  390, 768, 1024, 1260 and 1440px. Desktop and mobile captures were visually inspected
  internally. No external network requests, customer sends or page errors occurred.
- React checklist: semantic labels/buttons, status/alert announcements, safe plain
  text rendering, CSS Modules, derived preview state, stable API identity, per-owner
  component reset and unmount guards. No dangerous HTML or customer fetches in preview.
- Existing Firestore policy explicitly allows only the parent settings document;
  nested copy/history/receipt documents remain covered by recursive deny. Rules are
  unchanged; emulator deployment testing is N/A for a rules change.

## Decision and residual risk

Technical checks pass for a draft PR and owner preview. Merge/production remains
pending owner visual approval under `AGENTS.md`. No Firebase staging/prod API deployment
or authenticated live save was performed, so real IAM/CORS and integration verification
remain a required release gate. The HTML preview proves the UI, not Firebase transport.
Its persistence is local to that demonstration.

The default producer fallback intentionally favors existing eligible delivery if the
optional copy settings cannot be read. An administrator should monitor existing
communication health logs after release. Versions already queued remain immutable;
edits apply only when a producer constructs new queue content (per-batch snapshot
for task workers). Meta-approved message bodies remain outside this editor.

Owner: DEMAC maintainer and business owner. Due: before the separately authorized
production release. No unresolved critical/high technical finding; no production
action is authorized by this self-review.
