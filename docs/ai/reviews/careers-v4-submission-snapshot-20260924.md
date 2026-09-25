# Review: original submitted presentation
## Review mode
- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review
Reviewer and implementer: the same ChatGPT maintainer, in separate passes.

## Scope reviewed
Parent 35d996bc; complete bounded snapshot diff and its public/preview/admin callers.
Requirements LANG-04 and A06/A07/L10/L12/N09 of the provided V4 package.
Existing Careers application/session/mail/notes authorities remain the only owners.
No operational module, access rule, SMTP worker or real-data migration is changed.

## Findings
| Severity | Location | Evidence / treatment |
| --- | --- | --- |
| Medium, resolved | original strings | Existing canonical validators trim for contact/answer compatibility. Capture bounded originals separately rather than retroactively rewriting canonical consumers. Reject overlong raw whitespace. |
| Medium, resolved | schema/locale | Server derives current reviewed labels and validates the UI presentation version. Caller-supplied snapshot/notes cannot become evidence. |
| Medium, resolved | replay | Explicit locale and version join the raw-profile fingerprint. Legacy profile-only replay remains compatible. Replay occurs before current-job validation, preserving first committed evidence after later edits. |
| Medium, resolved | historical display | New readers use only schema-1 evidence. Earlier records retain their old saved values; no language is inferred or backfilled. Plain React text/pre-wrap preserves originals without HTML execution. |
| Low, recorded | country/policy presentation | Original country codes retained, not a claim of recording OS/ICU display labels. Live policy language is explicitly unknown. Reviewed policy localization is a separate pending block. |
| Medium, recorded | deployment ordering | This feature changes the request/record contract additively. A future approved rollout deploys the server version before enabling the matching frontend. This preview is isolated; no real release here. |

## Verification
Baseline: 115 PASS before editing. Combined final local focused gates: 141 PASS,
0 FAIL, 0 skipped; full Next types and build/prebuild gates PASS; Functions existing
syntax gate PASS. New snapshot-specific tests cover raw values/HTML/whitespace, schema
spoofing, old clients, stale versions, hidden values, atomic failure, post-commit loss,
unchanged stage/note evidence, inactive admin denial and option-label identity.
Required CI additionally exercises actual Firebase emulators (including concurrent replay)
and Chromium/WebKit/Firefox readers, captured after submit and after admin reload.
CI/browser results are to be recorded at the final pushed commit, not assumed from this note.

## Decision
- [x] Pass with recorded follow-up for preview CI
- [ ] Approved for merge or production
Final CI, real rendered inspection and owner validation are required. Physical device,
live policy approval, real antivirus/SMTP and persistent owner staging are not certified.
No new credentials/specifications needed for isolated development. No new collection or
permission; originals expire with the existing application record. Coherent code revert
does not delete candidate records or the additive evidence already stored.
