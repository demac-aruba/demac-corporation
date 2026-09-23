# Careers V4 question navigation — adversarial self-review checkpoint

Mode: **Solo Maintainer Review**, not independent review. This is a separate
post-implementation inspection of the initial presentation/navigation slice,
not the final Deep Review of all V4 persistent contracts and email behavior.

## Inspected surfaces and findings
- Both existing public and preview consumers use the same screen planner,
  renderer and existing history controller. No alternate public form was added.
- Stable `profile:` / `role:` identities survive insertion and reordering and
  prevent collisions between standard and configured questions. Legacy stage
  links normalize to a valid earlier question without bypassing validation.
- Hidden conditional answers are not relabeled or overwritten. Existing shared
  visibility/submit rules exclude them; tests retain the original in-memory value.
- Review edits target the actual question. Returning to review rechecks all earlier
  required fields (including relevant years after changing total years).
- Existing router state must be preserved on ALL history writes, not only initial
  replaceState. Corrected in this slice; actual Back/Forward browser tests remain
  required. Route state carries only identifiers, stage and review flags.
- Multiselect changes do not submit or navigate. Enter in textarea remains a
  newline; composition Enter is prevented from submitting. Synthetic browser
  events are not certification of every physical keyboard/input method.
- Photo generation ownership, original file references, existing submission lock,
  server session/status/upload and final commit authority remain unchanged.
- Full-form errors are projected to the current conceptual screen; no validation
  rules or prior assertions were weakened. Optional questions can be skipped.
- Fixed-width functional icons and connected circles are retained; form-only
  layout has one reading column. Sticky form controls were removed to reduce
  keyboard/focus obstruction. Actual screenshots and browser overflow checks
  are still required before visual acceptance.
- Review text uses pre-wrap. This only preserves client display; the pre-existing
  server normalization is unchanged and is explicitly not claimed V4-compliant.

## Evidence and residual risk
Local pure contracts: 33 PASS, zero FAIL/SKIP. Browser script syntax: PASS.
Changed-head full typecheck/build/browser and visual screenshots must be checked
separately; baseline CI is not new-code evidence. Persistent bilingual/admin,
mail, document category and production readiness work remains as listed in the
task record. Image manifest mismatch remains unresolved, not waived.

Decision: suitable to submit as an isolated implementation checkpoint for actual
CI validation; NOT READY FOR V4 PRODUCT ACCEPTANCE, MERGE OR PRODUCTION.
