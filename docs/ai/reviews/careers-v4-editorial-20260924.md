# Review: Careers bilingual editorial preparation

## Review mode
Solo Maintainer Adversarial Review. Implementer and reviewer: the same development
agent, in separate passes. This is not an independent review or release approval.
Base: 07afd841c759bb81927b389db292ce9e28a11d2d. Review scope: the complete editorial
increment recorded by tasks/careers-v4-editorial-20260924.md, not the entire pending V4.

## Adversarial findings and corrections
- New unsaved editor originally derived revision 2 from its empty initial state while
  the server correctly used revision 1. Corrected to treat version-0 editors as new;
  browser integration asserts revision 1 survives the initial save and reload.
- Shared preview panel originally relied on the authenticated parent's CSS scope.
  Added its own existing Recruitment root scope, without any global selector changes.
- Preview parser errors could escape the event handler. Catch and retain draft values;
  use a separate explicit draft-save action, preserving the old ordinary-save action.
- Earlier live-browser test changed English while keeping Spanish approved. It now
  explicitly marks that translation Draft before the source revision, preserving the
  stale-candidate recovery assertions rather than weakening publication validation.
- Generated Next configuration/type stubs are excluded from the intended diff.

## Boundaries checked
The existing save transaction rechecks active admin permissions, expected version and
idempotency before writing the canonical vacancy. Translation-only changes do not alter
English revision; English changes invalidate previous reviews. Public projection strips
unreviewed/stale/incomplete Spanish and whitelists fields. No candidate answer or document
is sent to an AI/translation service; no new collection, sender, role, credentials or rules.
Existing incoming omission preserves translations. Explicit alignment removes stale
translation keys only in the pending editor; no historical application is rewritten.

## Verification at publication checkpoint
Local: baseline 41 contracts PASS; new 39 editorial and transaction cases PASS. Combined
suite including existing core/architecture: 89 PASS, zero failed/skipped. Existing backend
suite: 14 PASS (7 overlap the combined suite; not 103 distinct cases). Typecheck PASS.
Full preview build and existing prebuild gates PASS before final scope-only UI adjustments;
the complete final source must pass CI typecheck/build before being called reviewed.
Syntax and git diff checks PASS. Local browser navigation was blocked by administrator
policy; no local rendered check is claimed or policy bypassed. CI uses the existing
isolated browsers and actual demo Firebase emulators; results must be recorded on PR 527.

Added checks cover English/Spanish manual authoring and reload; stale review before Open;
late server setup rejection; retained editor on cancelled Settings/Reload; explicit draft
fallback; cross-instance translated drafts; simultaneous version conflict; and old-client
omission. Existing candidate files, original schemas, retries and native navigation remain.

## Decision and residual risk
Conditional preview checkpoint only; final CI/rendered evidence is still required and
must not be waived. Full public EN/ES, localeAtSubmit/snapshots, document categories and
independent mail jobs remain pending. Physical devices and SMTP delivery NOT RUN.
No merge, production activation, real vacancies, live mail or data migration is authorized
by this review. Owner visual review remains required for the full V4 iteration.
