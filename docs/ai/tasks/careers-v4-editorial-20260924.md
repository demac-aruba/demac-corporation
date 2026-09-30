# Task: versioned English/Spanish editorial preparation

## Context and scope
Christian requested continued implementation of Careers V4 after the visual preview.
This increment starts from remote 07afd841c759bb81927b389db292ce9e28a11d2d on
feature/careers-v4-20260923, PR 527. The additional tooling commit is preserved.
It extends the existing Recruitment editor and canonical vacancy write path; it is
not the complete public EN/ES experience and does not activate recruitment.

Included: manual Spanish authoring, English source revisions, review/completeness
checks, safe old-client reads/writes, explicit Save draft, publication preflight,
retained fields on rejection and guarded Settings/Reload actions. The same editorial
panel is available in the clearly labelled in-memory Recruitment preview.

Not included: public locale selection/rendering, localized privacy/errors, final
submission locale/snapshots, document categories, the two email jobs, new providers,
production settings, secrets, roles, rules, migrations, merge or production deployment.
Those remain open requirements rather than being implied by translated metadata.

## Governance and authority
Deep Review; persistent editorial metadata changes require a separate Solo Maintainer
Adversarial Review. Firebase functions/careers remains the authority. One vacancy owns
English root fields and optional translations.es. No collections or identities are
created. Existing users active/admin checks, optimistic version and operation/audit
transactions remain. The shared editorial module is pure and receives no candidate
answers, documents, tokens, locations or provider credentials.

The existing immutable jobSnapshot still protects prior applications. This increment
must not be presented as implementing localeAtSubmit or original-answer localization.
Existing option values, including Yes/No, remain compatible; translated labels never
become stored answer values. Website Manager retains global content ownership.

## Acceptance
- Spanish draft text can be saved without SMTP/scanner setup or translation approval.
- English semantic changes derive a new revision on the server, not from client input.
- Stale/incomplete/unapproved Spanish is excluded from public translation metadata.
- Open with stale Approved Spanish is rejected atomically; explicit Draft remains valid.
- English-only publication can retain an unfinished Spanish Draft without advertising it.
- Old clients omitting translations preserve existing authored metadata.
- Translation review does not mutate question IDs, condition values or prior snapshots.
- Editor failures, cancelled Settings navigation and cancelled Reload preserve all fields.
- Existing candidate and operational regression gates remain unchanged.

## Verification plan
Run baseline 41 contracts/typecheck, new shared and transaction cases, backend contracts,
full Next build and existing prebuild gates. Extend real demo-emulator browser integration
with manual Spanish entry, reload, stale review, preflight and a late setup rejection.
Retain screenshots and test mobile overflow. Retain existing candidate file/version/retry
journey, adapting its authoritative source edit to mark Spanish Draft explicitly.

Local browser navigation is blocked with ERR_BLOCKED_BY_ADMINISTRATOR; no policy is
changed to bypass it. Rendered acceptance uses the existing isolated CI browsers.
CI and deployment results are recorded against the eventual remote commit in PR 527.

## Rollback
Revert this coherent increment before any further locale work. No production data was
migrated. For any future release, do not write vacancies with an older deployed service
that drops the new metadata; preserve/export authored translations or forward-fix first.
