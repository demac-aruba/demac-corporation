# Careers V4 — question navigation checkpoint

## Authority and scope
Christian supplied the complete V4 specification and five visual references on
2026-09-23. Work is restricted to `feature/careers-v4-20260923`; no merge or
production activation is authorized. Existing main was
`38542864b07ef18b32542ff08118fe9eea1526aa`. Baseline source was archived at
`d6784a6e333dfc9c5b8aaf70f0bd3955dae40a6c` after adding the review-only workflow.

This first, bounded presentation/navigation slice replaces the shared three-page
form with one conceptual question per screen. Documents and review remain
explicit summary screens. The existing CareersPublic and CareersPreview both
consume it. It is not completion of V4.

| Area | Existing authority / disposition |
| --- | --- |
| Validation | Existing shared `functions/careers/form-contract` and server, unchanged. Screen validation only projects their existing errors. |
| Submission and files | Existing public session/upload/submission path, unchanged. No backend, collection, security rule, limit or permission change. |
| Navigation | Extend existing `useCareersNavigation`; stable namespaced question IDs, old stage links retained, Next history state preserved. No answers/files/tokens in history. |
| Drafts | Existing tab memory; controls preserve values and file objects across steps. Reload/close loss is stated, not presented as autosave. |
| Presentation | Existing brand and connected-circle stepper; focused question column, explicit Continue, numeric years, independent experience/availability, precise review editing. |

## Reference inventory
All annexes and five images were read/opened individually. The nine text/utility
files match the supplied manifest; the five mounted PNGs have different byte
counts and SHA-256 values, although each is 941 x 1672. The manifest was not
rewritten. V01 remains FAIL for byte identity; no cause or original equivalence
is certified. Available images guide this isolated work; release acceptance must
resolve the discrepancy. No phone bezel or fictitious reference data is UI data.

## Verification before implementation
GitHub Actions review run `35906146167`, baseline head `d6784a6e...`, passed the
existing form contracts, app types/build including all prebuild gates, and the
existing rendered UI/navigation checks. This is baseline evidence, NOT evidence
for the subsequent source changes. Local clone/npm installation failed DNS;
the exact tracked source was recovered through the read-only CI archive artifact.

## Local verification of this slice
Node 22.16.0: 18 existing cross-layer form contracts plus 15 new question-flow
contracts pass, zero skipped/failed. Changed browser scripts pass `node --check`.
Syntax transpilation is not a complete TypeScript check. Full changed-head
build/browser evidence is recorded only after the scoped workflow completes.
Existing browser scenarios have been adapted to use the actual individual
questions, preserving validation, conditional answers, native navigation,
files, consent, success idempotency, and recruitment preview assertions.

## Remaining V4 work — not implemented by this checkpoint
- Full public EN/ES interface and approved dual editorial content, versioned
  original snapshots and admin controls; existing server text normalization is
  unchanged and is not certified against V4's original-response requirement.
- Bilingual candidate confirmation plus independent internal copy in the existing
  persistent queue; no real email or provider verification.
- Configurable document categories and approved ID policy, real persistent
  isolated integration, and release/retention checks.
- Shared list/detail/success fidelity, authorized manageable hero imagery,
  public/admin parity and the complete per-reference EN/ES acceptance matrix.
- Exact-head screenshots/visual review and an owner-accessible integrated preview.
  Physical iPhone/Galaxy/Mac/Windows devices are NOT RUN.

## Reversibility and release boundary
Keep this branch unmerged. Revert this coherent question-navigation commit to
restore the previous UI; it has no data migration or production writes. The
review workflow has read-only repository permissions, demo configuration,
credential-free checkout and no deployment job. Production activation, real
vacancy publication and emails remain prohibited without new explicit approval.
