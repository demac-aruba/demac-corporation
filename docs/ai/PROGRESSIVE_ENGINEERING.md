# DEMAC Progressive Engineering Assurance

## Purpose

DEMAC builds product iteratively. The engineering process must protect canonical data and
production while also allowing the business owner to see, test, and reshape a concept before the
team spends time and infrastructure cost hardening a design that may still change.

The core rule is:

> **Minimum safe architecture first; product acceptance second; deep hardening before merge.**

This document changes the order of assurance work. It does **not** weaken the Human Approval
Boundary, source-of-truth rules, security requirements, or final release quality.

## Risk classes

### LOW

Examples: labels, spacing, sorting, visual layout, presentation-only fields, non-authoritative
copy, harmless navigation adjustments.

Expected process:

- Short authority/scope check.
- Implement.
- Focused syntax/type/UI verification.
- Product review if the result is subjective or visible.
- No full architecture review unless the change reveals a broader issue.
- Final CI/build only when required for merge/release.

### MEDIUM

Examples: employee schedules, Van crew UX, maintenance workflows, ordinary CRUD, new operational
controls, non-financial business rules.

Expected process:

- Authority & Safety Check before coding.
- Functional prototype using existing sources of truth.
- Focused tests for the primary behavior and obvious failure path.
- Product review and iteration.
- After owner acceptance: architecture/integration hardening, regression tests, concurrency and
  recovery analysis where relevant, documentation/rule updates, adversarial review, final CI.

### HIGH

Examples: Payroll calculations, Booking Authority capacity, WhatsApp production messaging,
financial posting, security/permissions, migrations, destructive operations, secrets,
production-data transformations, creation/change of a source of truth.

Expected process:

- Deep authority/security analysis before implementation.
- Safe prototype must not write destructive or ambiguous production state.
- Critical invariants, authorization, and rollback/recovery protections are front-loaded.
- Product review still occurs before unnecessary polish, but high-risk gates cannot be deferred
  merely for speed.
- Full hardening and release gates are mandatory before merge/deploy.

If classification is uncertain, use the higher risk class until evidence supports lowering it.

## Stage 1 — Authority & Safety Check

Keep this concise for LOW/MEDIUM work. Answer:

1. What behavior is being changed?
2. Which existing component/service/data source owns it?
3. Is there an existing canonical source of truth that must be reused?
4. What adjacent modules can be affected?
5. Is there security, financial, destructive, migration, messaging, or production-data risk?
6. What risk class applies?

Do not conduct a repository-wide audit unless the answers show it is necessary.

## Stage 2 — Functional Prototype

Goal: produce the smallest coherent implementation that lets the business owner evaluate the
actual concept and behavior.

Required:

- Respect known canonical authority.
- Avoid patch-on-patch duplication.
- Keep changes reversible.
- Run focused checks sufficient to prove the requested path works.
- State known limitations clearly.

Normally deferred until product acceptance:

- exhaustive regression expansion;
- broad architecture cleanup unrelated to the requested behavior;
- final ADR/documentation polish;
- full adversarial review;
- repeated full CI/build/deployment cycles.

Prototype does not mean disposable bad architecture. If the only way to prototype is to violate a
source of truth, security boundary, or destructive-data rule, stop and redesign before coding.

## Stage 3 — Product Review

When the concept is testable, report:

> **🟡 READY FOR PRODUCT REVIEW**

This means the owner can evaluate UX, workflow, behavior, terminology, and product fit. It does
**not** mean production/release ready.

The owner may accept, reject, or request iteration. Repeat Stage 2 ↔ Stage 3 until the owner says
the module/change is functionally and conceptually how they want it.

Do not repeatedly perform final hardening during this loop unless a discovered risk requires it.

## Stage 4 — Engineering Hardening

Starts after product acceptance, or earlier only where risk requires.

Review the **accepted** implementation as a whole:

- canonical authority and duplicate-source audit;
- layering/domain placement and removal of prototype-only shortcuts;
- affected callers and transitive integrations;
- permissions/security/privacy;
- data preservation and historical behavior;
- concurrency, retries, idempotency;
- failure/recovery and partial-success cases;
- performance/scalability where applicable;
- regression coverage;
- business-rule, authority-matrix, parity, debt, and ADR updates when evidence requires them;
- Solo Maintainer Adversarial Review or independent review.

Hardening should preserve owner-approved product behavior unless a safety/architecture issue makes
that behavior unsafe or contradictory. If hardening requires a visible product change, return to
Product Review for that behavior.

## Stage 5 — Release Gate

Run the final applicable gates in `QUALITY_GATES.md` on the final head.

Confirm:

- owner-accepted behavior remains intact;
- final type/syntax/tests/build are green as applicable;
- required integrations/regressions are green;
- review findings are closed or explicitly recorded;
- branch is current/mergeable;
- production/human approval boundaries are respected.

Then report:

> **🟢 READY FOR MERGE**

Do not use `READY FOR MERGE` for a prototype.

## Build and infrastructure cost policy

The engineering protocol must be economical as well as safe.

- Work locally or with focused tooling during active iteration whenever possible.
- Batch coherent edits into meaningful checkpoints instead of pushing every micro-change.
- Avoid multiple remote commits whose only purpose is intermediate notes/review text while each
  commit triggers the same application build.
- Do not require full application builds for docs-only changes.
- Use path/ignored-build configuration so docs-only and unrelated-app changes do not trigger
  expensive builds when the hosting platform supports it.
- In monorepo/multi-project hosting, build only affected projects when possible.
- Prefer one product-review preview and one final release-quality preview/build rather than a
  preview for every intermediate edit.
- A new code change after a passing gate invalidates the relevant gate; a docs-only change does
  not automatically invalidate compiled-code evidence unless that documentation participates in
  runtime/generated output.
- Never skip a truly required final release gate merely to save money.

## Status vocabulary

### WORK IN PROGRESS

Concept is still being implemented or changed.

### 🟡 READY FOR PRODUCT REVIEW

Usable/testable concept; focused checks passed; not yet deeply hardened or release-ready.

### PRODUCT ACCEPTED

Business owner confirms the concept/workflow/UX is how they want it. Engineering Hardening can
now optimize internals without casually changing behavior.

### ENGINEERING HARDENING

Architecture, integration, regression, failure/recovery, documentation, and adversarial review
are being completed on the accepted behavior.

### 🟢 READY FOR MERGE

Product accepted + hardening complete + final required gates pass + no unresolved merge blocker.

## Non-negotiables retained

This progressive workflow never authorizes:

- direct implementation on `main`;
- bypassing or weakening required gates;
- production deployment without required human approval;
- destructive migrations/data deletion without explicit approval;
- secrets/security/access changes without explicit approval;
- duplicate systems of record;
- knowingly insecure or ambiguous authority;
- claiming unperformed verification.
