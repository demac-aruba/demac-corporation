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
3. Perform a short **Authority & Safety Check** before editing: identify the product surface,
   source of truth, security/data risk, and whether the change can affect protected systems.
4. Classify the work as LOW, MEDIUM, or HIGH risk using
   [docs/ai/PROGRESSIVE_ENGINEERING.md](docs/ai/PROGRESSIVE_ENGINEERING.md).
5. Prefer the smallest reversible change. Do not deploy, migrate production data, rotate
   secrets, or modify production configuration without explicit authority.
6. Do not claim success without reporting the exact verification performed.

The Authority & Safety Check is intentionally short for ordinary product iteration. A full
architecture review is normally deferred until the owner accepts the product behavior, unless
risk requires deeper analysis before implementation.

## Progressive engineering rule

DEMAC uses **Progressive Engineering Assurance**. The normal sequence is:

1. Authority & Safety Check.
2. Functional Prototype / implementation.
3. Focused verification sufficient for product evaluation.
4. **🟡 READY FOR PRODUCT REVIEW** — the business owner validates behavior and UX.
5. Iterate between implementation and product review until the owner confirms the module is
   functionally and conceptually correct.
6. Engineering Hardening — full architecture/integration review, regression coverage,
   failure/recovery review, documentation, and adversarial review proportional to risk.
7. Release Gate.
8. **🟢 READY FOR MERGE**.
9. Merge/deploy only after the applicable human approval boundary is satisfied.

Do not perform expensive final hardening repeatedly while the product concept is still being
changed. Do not use the prototype phase as permission to create duplicate authority, destructive
writes, insecure paths, or knowingly broken architecture. High-risk work may require hardening
controls earlier; see the progressive engineering document.

## Absolute quality-gate rule

Required tests and checks may never be disabled, skipped, weakened, deleted, waived,
or bypassed merely to obtain `PASS`. A failing required check must be fixed or explicitly
escalated, and it remains `FAIL` until an authorized resolution is recorded.

The set of **required** gates depends on the current stage and risk class. Product-review gates
may be focused; merge/release gates remain strict.

## Branch and review policy

- A Builder must never implement directly on `main`. Every implementation must use an
  approved `feature/`, `fix/`, `chore/`, `docs/`, or other explicitly approved task branch.
- During the prototype/product-review loop, keep commits/checkpoints coherent and avoid pushing
  every micro-edit merely to create a remote checkpoint.
- When an independent qualified reviewer is available, prefer an independent review by
  someone who did not implement the reviewed change.
- DEMAC is currently allowed to operate in **Solo Maintainer Review Mode** when no
  independent engineer/reviewer is reasonably available. In that mode, absence of an
  external reviewer must not block otherwise complete engineering work.
- Solo Maintainer Review Mode requires a fresh adversarial review pass during **Engineering
  Hardening**, explicitly separate from the implementation pass. It must inspect the accepted
  product behavior, complete diff, affected callers, authority/security boundaries,
  concurrency/idempotency, failure/recovery behavior, applicable quality gates, findings, and
  residual risk.
- A solo-maintainer review must never be described as an "independent review."
- The business owner is not required to act as a technical code reviewer. The owner's product
  review approves intent/behavior; the maintainer remains responsible for technical evidence.
- Green CI alone is never sufficient final review evidence.
- Production deployment, destructive or irreversible actions, security/access changes,
  secret changes, destructive migrations, production-data deletion, and creation of a
  new source of truth still require explicit human approval.

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

## Cost and build discipline

Engineering safety does not require wasteful builds.

- Prefer local/targeted validation during active iteration.
- Batch coherent changes before pushing; do not push each small UI/text/test edit separately.
- Do not trigger full CI, preview deployments, or production-like builds repeatedly before
  product acceptance unless the risk class requires them.
- Documentation-only changes require documentation checks, not application builds, unless the
  documentation change alters generated/runtime artifacts.
- Configure and preserve build-ignore/path filters where supported so unrelated apps and
  docs-only commits do not consume build resources.
- In a multi-project repository, only applications affected by the diff should build when the
  platform supports selective builds.
- A final release-quality build still must run before merge when required by
  [docs/ai/QUALITY_GATES.md](docs/ai/QUALITY_GATES.md).

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
must remain explicitly separated during Engineering Hardening.

1. Create a lightweight task record when useful; do not require a long task document for every
   small product iteration.
2. Perform the Authority & Safety Check and risk classification.
3. Implement the narrowest coherent prototype/change.
4. Run product-review gates from [docs/ai/QUALITY_GATES.md](docs/ai/QUALITY_GATES.md).
5. Present **🟡 READY FOR PRODUCT REVIEW** and iterate until the owner accepts the behavior.
6. Run Engineering Hardening proportional to risk: architecture/integration review, required
   regressions, documentation/rule updates, failure/recovery analysis, and review using
   `docs/ai/templates/REVIEW_TEMPLATE.md`.
7. Run final release gates.
8. Present **🟢 READY FOR MERGE** only when release criteria are satisfied.
9. Record durable architecture decisions with `docs/ai/templates/ADR_TEMPLATE.md` when a real
   architecture decision is made; do not create ADRs for routine UI/product iteration.

## Definition of done

A prototype is ready for product review when the requested concept is coherent enough to test,
the authority/safety boundary is respected, focused verification passes, and known limitations
are stated.

A change is ready for merge only when the owner-accepted behavior is preserved through
Engineering Hardening; permissions and failure behavior are explicit; applicable final automated
and manual checks pass; no unrelated files changed; documentation is current where evidence
requires it; and remaining risk is stated.

Repository guidance:

- [Progressive engineering](docs/ai/PROGRESSIVE_ENGINEERING.md)
- [System map](docs/ai/SYSTEM_MAP.md)
- [Authority matrix](docs/ai/AUTHORITY_MATRIX.md)
- [Business rules](docs/ai/BUSINESS_RULES.md)
- [Legacy parity](docs/ai/LEGACY_FEATURE_PARITY.md)
- [Architecture debt](docs/ai/ARCHITECTURE_DEBT.md)
- [Known failure patterns](docs/ai/KNOWN_FAILURE_PATTERNS.md)
- [Security rules](docs/ai/SECURITY_RULES.md)
- [Scalability rules](docs/ai/SCALABILITY_RULES.md)
- [Quality gates](docs/ai/QUALITY_GATES.md)
