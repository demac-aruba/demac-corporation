# Careers V4 — locale selection and read-only vacancy presentation

## Bounded checkpoint

Continue the owner-approved V4 work from remote 061b51d1d75c755b47e2dffb1ff592fa38fef42a on feature/careers-v4-20260923. This is the first public-language slice, NOT a complete EN/ES application release. The existing static export, public server authority and in-memory preview are retained.

Already present: reference-led shared candidate pages, one-question navigation and versioned English/Spanish Recruitment authoring. Added here: explicit language selection, precedence, stable history and approved read-only Spanish vacancy presentation in both consumers. Pending: question/document/error/consent/receipt localization, submission-language snapshots, independent mail jobs, document categories and persistent isolated owner staging. Current forms remain in English and display an explicit Spanish notice rather than claiming translation coverage.

## Implementation and authority

- Query en/es takes precedence over an explicitly saved language, then ordered supported browser preferences, then English. No location or language-skill inference.
- Existing navigation controller owns both routes and the selected language. Manual selection replaces the current history URL, preserves the full existing Next history state and never calls submission or resets the form. Back/Forward retain the latest manual selection.
- Only the language preference is written to localStorage. Blocked storage does not block the experience. Answers, files and session credentials remain where the existing implementation keeps them, never in URL/localStorage.
- Canonical job IDs, department filter values, question/option identities, counts and form validation are unchanged. The display-only projection uses the existing reviewed/current editorial contract; missing, stale or incomplete translations retain English with an explicit notice. Search matches both approved language presentations without changing its saved text.
- One manually authored, clearly synthetic HVAC preview translation exercises the feature. No production vacancy is seeded or edited. The visual editor test now deliberately makes this reviewed fixture incomplete; existing server authoring tests still cover starting a translation from none.
- Global Website Manager hero content and global public navigation remain in their existing language and are marked accordingly. No runtime provider translates editorial or candidate content.

## Focused self-review (same maintainer; not independent)

Checked the route controller, both consumers and shared projection. Locale changes do not create a new React key, do not reinitialize ApplicationFunnel, do not mutate canonical vacancy objects, do not replace option values and do not call persistence. Full existing browser/contract checks remain required. The new browser journey re-reads multi-selection, original mixed-language text and a selected PDF after language/history changes. No test matrix is reduced and no retries or waived checks are introduced.

## Verification before remote CI

97 local shared/form/editorial/locale contracts passed, zero failures/skips; full local Next typecheck and script syntax/diff checks passed. Existing prebuild gates passed locally; the first build process exceeded its execution timeout and the subsequent Next build completed. Final fresh full build and actual browser checks are required in CI before sharing this checkpoint as verified.

Local Chromium was blocked even for localhost by the execution environment (ERR_BLOCKED_BY_ADMINISTRATOR). No bypass was attempted. Browser behavior and visual acceptance are NOT claimed from local tests. The scoped CI preserves the existing visual/navigation journeys and adds three locale engine/viewport journeys plus six initial-language/storage cases, retaining separate screenshots and locale-report.json.

## Release and rollback

Preview only. No main merge, production configuration, security rules, secrets, real messages, real candidate data, ID intake or data migration. Revert this coherent UI/preference slice to restore the prior candidate presentation; no stored application data needs rollback. Complete V4 and owner visual approval remain pending.
