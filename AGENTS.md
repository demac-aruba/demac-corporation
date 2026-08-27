# DEMAC AI Engineering Guide

This file governs the entire repository. A more local `AGENTS.md` may add stricter
instructions for its subtree but may not weaken these rules.

## Non-negotiable platform rule

Expo has changed. Before writing or changing any Expo or React Native code, read
the exact versioned documentation at <https://docs.expo.dev/versions/v57.0.0/>.
Do not rely on unversioned examples or remembered APIs.

## Start every task with evidence

1. Read the request, this file, and any nearer `AGENTS.md`.
2. Inspect Git status and the files that own the behavior. Preserve unrelated work.
3. Identify the product surface, authority boundary, business-rule IDs, security
   impact, and required quality gates before editing.
4. Prefer the smallest reversible change. Do not deploy, migrate production data,
   rotate secrets, or modify production configuration without explicit authority.
5. Do not claim success without reporting the exact verification performed.

## Absolute quality-gate rule

Required tests and checks may never be disabled, skipped, weakened, deleted, waived,
or bypassed merely to obtain `PASS`. A failing required check must be fixed or explicitly
escalated, and it remains `FAIL` until an authorized resolution is recorded.

## Branch and review policy

- A Builder must never implement directly on `main`. Every implementation must use an
  approved `feature/`, `fix/`, `chore/`, or other explicitly approved task branch.
- When an independent qualified reviewer is available, prefer an independent review by
  someone who did not implement the reviewed change.
- DEMAC is currently allowed to operate in **Solo Maintainer Review Mode** when no
  independent engineer/reviewer is reasonably available. In that mode, absence of an
  external reviewer must not block otherwise complete engineering work.
- Solo Maintainer Review Mode requires a fresh adversarial review pass that is explicitly
  separate from the implementation pass. The reviewer pass must re-read the request,
  inspect the complete diff and affected callers, verify authority/security boundaries,
  challenge concurrency/idempotency and failure/recovery behavior, run the applicable
  quality gates, record findings, and state residual risk.
- A solo-maintainer review must never be described as an "independent review." It is a
  documented adversarial self-review under constrained team staffing.
- Green CI alone is never sufficient review evidence.
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

## Required delivery workflow

Use the role contracts in `docs/ai/roles/` as review lenses. In Solo Maintainer Review
Mode, one person or agent may perform both Builder and Reviewer passes, but the evidence
must remain explicitly separated and the reviewer pass must not be represented as
independent.

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
and failure behavior are explicit; relevant automated and manual checks pass; no
unrelated files changed; documentation is current; and remaining risk is stated.

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
