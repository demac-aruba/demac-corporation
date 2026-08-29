# DEMAC AI Engineering Guide

This file is the canonical engineering protocol for every human or AI agent working in
this repository. A more local `AGENTS.md` may add stricter instructions for its subtree
but may not weaken these rules. The default delivery mode is **Fast Product Validation**;
use **Deep Review** only when the owner requests it or the change is high risk.

## Non-negotiable platform rule

Expo has changed. Before writing or changing any Expo or React Native code, read
the exact versioned documentation at <https://docs.expo.dev/versions/v57.0.0/>.
Do not rely on unversioned examples or remembered APIs.

## Start every task with evidence

1. Read the request, this file, and any nearer `AGENTS.md`.
2. Inspect Git status and the files that own the behavior. Preserve unrelated work.
3. Classify the task as Fast Product Validation or Deep Review before editing. For a
   routine task, inspect only the owning files and direct dependencies needed to make
   the requested behavior work; do not inventory the whole architecture first.
4. Prefer the smallest reversible change. Do not deploy, migrate production data,
   rotate secrets, or modify production configuration without explicit authority.
5. Do not claim success without reporting the exact verification performed.

## Delivery modes

### Fast Product Validation (default)

Use this mode for routine UI/UX changes, small bug fixes, and contained features that do
not change an authority boundary, security policy, data model, financial truth, or source
of record.

1. Confirm the requested behavior. Ask for clarification or show a mockup only when the
   behavior or visual design is genuinely ambiguous.
2. Reuse existing components, patterns, APIs, and save paths before creating new ones.
3. Implement the smallest coherent change. Do not add speculative abstractions, broad
   refactors, or unrelated cleanup.
4. Run types/syntax checks and the focused tests for the changed surface. Do not run
   repository-wide suites unless the change affects their consumers.
5. Publish a preview when the feature is visual or interactive.
6. Let the business owner validate that the concept and workflow are practical.
7. Merge and deploy only after the required human approval.
8. Perform architecture cleanup, broad optimization, and deep security hardening later,
   in a separate explicitly requested task or PR, after the concept is approved.

Fast mode does not require task/review templates, an ADR, a separate adversarial review
pass, or repository-wide architecture/security/scalability audits unless the change itself
creates evidence that one of those artifacts must change.

### Deep Review

Use Deep Review when the owner explicitly requests an audit, refactor, optimization, or
hardening pass, or before merging a high-risk change involving authentication, roles or
permissions, security rules, secrets, payments or financial state, destructive actions,
production-data migration, a new system of record/data model, infrastructure, or a broad
multi-module change. Incident fixes with material concurrency, retry, idempotency, or
recovery risk also use Deep Review.

When a task unexpectedly crosses into Deep Review, tell the owner why before expanding
the work. Then use the role contracts, templates, authority/rule mapping, adversarial
review, and broader quality gates described below.

## Absolute quality-gate rule

Required tests and checks may never be disabled, skipped, weakened, deleted, waived,
or bypassed merely to obtain `PASS`. A failing required check must be fixed or explicitly
escalated, and it remains `FAIL` until an authorized resolution is recorded.

## Branch and review policy

- A Builder must never implement directly on `main`. Every implementation must use an
  approved `feature/`, `fix/`, `chore/`, or other explicitly approved task branch.
- Fast Product Validation requires a focused self-check of the final diff and targeted
  verification, but it does not require a second, separately documented review pass.
- In Deep Review, prefer an independent qualified reviewer who did not implement the
  change when one is available. When none is reasonably available, DEMAC may use
  **Solo Maintainer Review Mode** rather than block otherwise complete work.
- Deep Review in Solo Maintainer Review Mode requires a fresh adversarial pass that is
  explicitly separate from implementation. It must inspect the complete diff and affected
  callers, verify authority/security boundaries, challenge concurrency/idempotency and
  failure/recovery behavior, run applicable gates, record findings, and state residual risk.
- A solo-maintainer review must never be described as an "independent review." It is a
  documented adversarial self-review under constrained team staffing.
- The business owner is not required to act as a technical code reviewer. The owner's role
  is to define/approve business intent and provide explicit human approval for actions that
  cross the Human Approval Boundary; technical review evidence remains the maintainer's job.
- In Deep Review, green CI alone is never sufficient review evidence.
- Production deployment, destructive or irreversible actions, security/access changes,
  secret changes, destructive migrations, production-data deletion, and creation of a
  new source of truth still require explicit human approval under the Human Approval
  Boundary below.

## Product boundaries

- The root application is the Legacy Expo 57 application and operational fallback.
- `apps/erp-next` is the greenfield Next.js ERP. New ERP capability belongs there
  unless the task explicitly requires a critical Legacy repair.
- `functions` is the privileged Firebase/backend and integration boundary.
- `services/whatsapp-bridge` and external providers are integration boundaries, not
  sources of domain truth.
- Do not copy Legacy patch chains into ERP Next. Extract requirements, rules, data
  contracts, and acceptance tests first.

## Authority and business truth

- Read [docs/ai/AUTHORITY_MATRIX.md](docs/ai/AUTHORITY_MATRIX.md) before changing a
  write path and [docs/ai/BUSINESS_RULES.md](docs/ai/BUSINESS_RULES.md) before
  changing domain behavior.
- UI visibility is not authorization. Enforce permissions at service/data access.
- AI may interpret, summarize, and draft; it must not invent prices, availability,
  policy, identity, financial state, or inventory state.
- High-impact actions require deterministic validation, explicit authorization,
  idempotency where retries are possible, and an audit trail.
- If sources disagree or authority is unclear, stop the write path and document the
  conflict instead of guessing.

## Engineering constraints

- Keep domain rules out of presentation components and provider adapters.
- Preserve canonical identity across Customer, Property (also named `Site`/`siteId` only in
  technical or compatibility contexts), Asset, Appointment, Work Order, Invoice, Payment,
  inventory, and communication records. Do not create a second Site identity, database, or
  collection for a Property unless a future explicitly approved ADR changes the model.
- Never expose secrets, credentials, tokens, private customer data, or internal AI
  prompts in source, logs, fixtures, screenshots, or customer-facing responses.
- Treat Firestore rules, Storage rules, authentication checks, CORS, webhook
  verification, and least-privilege service accounts as part of the feature.
- Any migration must be idempotent, dry-run capable, reconcilable, and paired with a
  rollback or forward-recovery plan.

## Human approval boundary

Explicit human approval is required before any destructive database/data migration,
production deployment, Firestore or other security-rule change that changes access,
secret or credential change, irreversible operation, deletion of production data, or
architectural creation of a new system of record/source of truth. Agent, CI, tool, or
product approval is not a substitute for human approval.

## Legacy retirement

Never delete Legacy compatibility code because of its filename, version, age, or name.
First perform dependency and reference analysis and classify it as `ACTIVE`,
`COMPATIBILITY`, `MIGRATION`, `DEAD`, or `UNKNOWN`. Only code proven `DEAD` and
unreferenced may be removed, and only within an approved task. `UNKNOWN` blocks removal.

## Deep Review workflow

This workflow is required only for Deep Review tasks. Fast Product Validation follows the
short workflow defined above. Use the role contracts in `docs/ai/roles/` as review lenses.
In Solo Maintainer Review Mode, one person or agent may perform both Builder and Reviewer
passes, but the evidence must remain explicitly separated and the reviewer pass must not
be represented as independent.

1. Define the task with `docs/ai/templates/TASK_TEMPLATE.md`.
2. Map affected authorities, rules, parity obligations, failure modes, and risks.
3. Implement the narrowest coherent change.
4. Run the applicable gates in [docs/ai/QUALITY_GATES.md](docs/ai/QUALITY_GATES.md).
5. Review with `docs/ai/templates/REVIEW_TEMPLATE.md` using either Independent Review or
   Solo Maintainer Adversarial Review mode.
6. Record durable architecture decisions with `docs/ai/templates/ADR_TEMPLATE.md`.
7. Update the AI engineering documents when evidence changes them.

## Definition of done

A change is done only when scope and acceptance criteria are satisfied; permissions
and failure behavior touched by the change are explicit; checks required by the selected
delivery mode pass; no unrelated files changed; documentation is current when its evidence
changed; and remaining material risk is stated.

Repository guidance:

- [System map](docs/ai/SYSTEM_MAP.md)
- [Authority matrix](docs/ai/AUTHORITY_MATRIX.md)
- [Business rules](docs/ai/BUSINESS_RULES.md)
- [Legacy parity](docs/ai/LEGACY_FEATURE_PARITY.md)
- [Architecture debt](docs/ai/ARCHITECTURE_DEBT.md)
- [Known failure patterns](docs/ai/KNOWN_FAILURE_PATTERNS.md)
- [Security rules](docs/ai/SECURITY_RULES.md)
- [Scalability rules](docs/ai/SCALABILITY_RULES.md)
- [Quality gates](docs/ai/QUALITY_GATES.md)
- [ChatGPT project setup](docs/ai/CHATGPT_PROJECT_SETUP.md)
