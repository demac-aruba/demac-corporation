# Careers editorial versions inside the existing vacancy authority

Status: Proposed for V4 preview review; production activation is not authorized.
Date: 2026-09-24. Owner: DEMAC Careers / Recruitment.
Related task: ../tasks/careers-v4-editorial-20260924.md

## Decision
English remains in existing canonical vacancy fields. Optional translations.es contains
editorial strings, question-label mappings and review/sourceVersion metadata. It never
owns vacancy identity, available positions, dates, status, answer kinds or conditions.

editorialVersion is derived inside the existing optimistic save transaction from the
semantic English fields, ordered questions, option values, required flags and file policy.
A caller-supplied revision cannot override it. Metadata-only Spanish edits, internal notes,
publication dates/status and openings do not make the English text a new revision.

Missing revision on a legacy record resolves to 1. Missing translations on an incoming
legacy save preserves existing translations; explicit {} removes the optional translation.
Incomplete/stale drafts may be saved. Public projection whitelists only reviewed,
complete Spanish tied to the current source revision. Opening with a stale Approved
translation fails with a specific error without a partial vacancy write. Saving Spanish
as Draft permits an explicitly English-only vacancy to open under all existing setup gates.

Translated question labels are associated with canonical question IDs. Existing options
retain their stored values as compatibility keys (including Yes/No); optionLabels supplies
Spanish presentation only. Relabeling an English option invalidates the Spanish review.
Aligning obsolete translated questions/options is an explicit admin action, never a silent
rewrite or reinterpretation of historical candidate answers.

## Alternatives and consequences
Separate Spanish vacancies would duplicate identity, headcount and applications; rejected.
Visitor-triggered translation would add provider cost, privacy risk and non-reproducible
content; rejected. Client-only validation would allow stale publication; rejected.
Manual review adds editor work but is usable with no translation provider or credentials.
No AI-translation button appears because this slice does not connect an authorized provider.

This is a contract/editor increment, not a claim that candidate EN/ES rendering or
localeAtSubmit is implemented. The candidate controller and mail pipeline remain separate
pending integration work. No new authority, datastore, role, network provider or security
rule is introduced. Existing snapshots and candidate values are not migrated.

## Verification and rollout
Shared pure contracts and negative transaction tests run locally and in CI. Existing
Firestore/Storage/Auth demo integration verifies cross-instance persistence, concurrent
edits and editor failure recovery. Preview only; keep PR draft until the entire V4 scope,
owner visual acceptance and all applicable gates are complete.
