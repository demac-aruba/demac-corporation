# Task: candidate form localization (LANG-02 UI slice)

## Scope and baseline
Christian authorized continued Careers V4 implementation and requested progress reports
per completed block. Start: 83def7b30c93b59fd9fb1cdd88e020c71a07b5b6,
feature/careers-v4-20260923 / PR 527. Preserve the verified selector, editorial authority,
shared public/preview form, native history, draft/file handling and previous UI.

This slice localizes the existing form, controls, selected files, review and receipt,
and maps existing errors to readable Spanish without changing validation authority.
It does not add a runtime translator, storage, provider, collection, production
configuration, role, security rule or live email. No merge or production activation.

## Contract and review boundaries
Use a bounded Deep Review of display/value separation as requested in V4.
English and Spanish question labels come only from the existing reviewed/current
editorial projection. Canonical question IDs, option values including Yes/No,
conditions, draft contents and file objects remain unchanged. Standard fields keep
their actual number/date/URL types. Free-text answers and file names are never
translation dictionary keys. Missing/stale Spanish stays labelled as English.

Fixed UI messages are deterministic local copy. Server code is retained on error
objects and selects a safe localized explanation; unrecognized service diagnostics
are not echoed or sent to a translator. The existing server remains the validator.
Changing language re-renders errors without resetting the form or clearing selections.

The configured live privacy prose currently has no language metadata or reviewed
Spanish version. Keep its exact original, mark the language unknown, and explicitly
show the pending Spanish-policy notice. The preview-only privacy explanation is
translated. This is not completion of all LANG-02: global Website Manager hero copy,
reviewed live privacy, submission-language snapshots and frozen localized mail remain
pending. Do not claim Spanish email delivery or preservation of every raw byte by the
existing backend normalizer; the original-response snapshot block remains separate.

## Acceptance and verification
- Same shared ApplicationFunnel serves public authority and in-memory preview.
- Standard question labels, approved role questions/options/help, buttons, progress,
  country names, native control labels and file feedback work in ES and EN.
- Selection values and conditional visibility remain canonical and backward-compatible.
- Mixed free-text paragraphs, whitespace and original filenames survive language
  toggles, history and editable review in the browser.
- Consent remains explicit; future-opportunity opt-in is not preselected.
- Receipt follows the existing committed authority acknowledgement; preview receipt
  states no live record/mail. No callback or effect resubmits during locale changes.
- Existing browser matrices remain; extend locale journeys through completion and add
  Spanish server-backed journeys to both existing emulator browsers, without removing
  their English version-conflict/retry/private-file checks.

Local types/build and 115 shared/unit contracts passed. Browser navigation is blocked
by the execution environment; no policy bypass was attempted. The exact final source
must pass existing isolated CI, including new Spanish browser/authority journeys.
Capture actual code per browser/viewport; inspect Spanish question, files, review and
receipt before the owner preview is described as checked. No physical-device claim.

## Rollback
Revert this scoped presentation/test increment coherently. No schema, deployed data or
mail job was migrated. Preserve earlier language selection and editorial authoring.
