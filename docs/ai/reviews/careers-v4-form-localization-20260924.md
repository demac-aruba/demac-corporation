# Review: candidate form localization

Mode: Solo Maintainer Adversarial Review, a separate pass by the implementer,
not independent review. Base: 83def7b30c93b59fd9fb1cdd88e020c71a07b5b6.

## Findings addressed
- Removing the English-only form notice must not imply every vacancy is translated.
  Role questions now consult the existing approved/current editorial gate and explicitly
  identify English-only questions. Free employer text is never passed to the UI dictionary.
- Native controls must not store translated labels. Radio/checkbox/select values remain
  original values; labels are separate. Tests challenge Yes/Sí conditions and stale review.
- Error strings must update after a language change without clearing a failed field.
  Keep raw keyed errors and render a locale projection, retaining server error codes.
- Arbitrary file names must not be interpolated before choosing a localized message.
  Store names separately and substitute them only once, after fixed-copy selection.
- Review answers matching UI words must not be auto-translated. Only known selection
  fields use label maps. Text/textarea values retain their original whitespace/newlines.
- Existing live privacy text has no locale metadata. Do not guess English or fabricate
  reviewed Spanish. Show the exact configured body with unknown lang and pending notice.
- Existing administration keeps default-English CountrySelect behavior; only public
  callers opt into localized country names. No global CSS/font/component key changes.

## Scope checked
Read all affected public/preview consumers, form/question components, editorial locale
projection and unit/browser callers. Submission payload construction, private upload
ownership, confirmation conditions, retries, server validators and mail authority are
unchanged. No secrets, candidate data, credentials or extra permissions are introduced.
Tests use synthetic files and demo Firebase only. Added Spanish authority journeys retain
both existing English browser journeys and all their failure-recovery assertions.

## Verification and residual risk
Local: 115 contracts PASS, zero failed/skipped; full Next typecheck/build and existing
prebuild gates PASS; script syntax and whitespace/diff checks PASS. Generated Next type
and config edits are excluded. CI/browser outcomes and exact commit are recorded in PR 527.
Local browser navigation is denied by environment policy; no local visual PASS is claimed.
The final code requires actual CI screenshots and owner visual acceptance.

This is not the final bilingual release: configured policy translation/global hero text,
immutable presented-language snapshots, raw-response server handling, independent mail,
additional document categories and persistent owner staging remain pending. Physical
Galaxy/iPhone/Mac checks and real SMTP are NOT RUN. No merge or production activation.
