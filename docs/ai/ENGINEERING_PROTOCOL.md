# DEMAC Engineering Protocol

## Architecture-First Development, Single Source of Truth & Four-Pass Validation

This protocol is mandatory for significant software-development work in the DEMAC repository. It complements `AGENTS.md`, `SYSTEM_MAP.md`, `AUTHORITY_MATRIX.md`, `BUSINESS_RULES.md`, `QUALITY_GATES.md`, `KNOWN_FAILURE_PATTERNS.md`, `ARCHITECTURE_DEBT.md`, `SECURITY_RULES.md`, and `SCALABILITY_RULES.md`.

If this document conflicts with `AGENTS.md`, the stricter requirement applies. Nothing here weakens the human-approval boundaries, independent-review requirements, security gates, branch policy, or production safeguards defined elsewhere in the repository.

---

## 1. Purpose

The purpose of this protocol is to prevent:

- patch-on-patch development;
- symptom fixes that leave the root cause intact;
- duplicated variables, constants, business rules, schemas, services, jobs, listeners, endpoints, or commands;
- conflicting implementations of the same behavior;
- multiple uncontrolled sources of truth;
- inconsistent data between ERP Next, Legacy, Firebase, integrations, provider configuration, GitHub, Vercel, or other infrastructure;
- temporary fixes becoming permanent architecture;
- regressions caused by locally correct but systemically unsafe changes;
- unnecessary coupling and technical debt;
- recreating functionality that already exists;
- implementation before understanding the architecture.

The governing principle is:

> **The correct solution is more important than the fastest solution.**

---

## 2. Do not code first

For every meaningful feature, bug fix, refactor, integration, automation, upgrade, or architectural change, do not begin by writing code.

First determine:

1. What outcome is actually required?
2. Which system currently owns the behavior?
3. What code already implements or influences it?
4. What data does it read and write?
5. What is the canonical source of truth?
6. Which modules depend on the behavior or data?
7. Which integrations are involved?
8. What side effects exist?
9. Which existing abstraction can be reused or extended?
10. Whether the requested implementation can be architecturally improved before coding.

A user request normally describes the desired business outcome. It does not automatically define the correct technical implementation.

---

## 3. Engineering responsibility

Treat the requester as the source of business intent, not as the required source of implementation detail.

The engineering process is responsible for determining:

- the correct layer;
- the correct authority boundary;
- the correct source of truth;
- the correct data contract;
- the safest implementation;
- required migrations;
- required compatibility behavior;
- the appropriate test strategy;
- rollback or forward-recovery requirements;
- security and observability implications.

Preserve the requested outcome while improving the implementation whenever a literal implementation would introduce duplication, conflicting truth, avoidable fragility, or architectural debt.

---

## 4. Absolute no-patch-on-patch rule

Do not add another special case merely because it is the smallest local edit.

Before adding any new:

- `if` branch;
- fallback;
- exception path;
- field;
- collection;
- table;
- environment variable;
- constant;
- state;
- listener;
- endpoint;
- cron job;
- queue;
- worker;
- validator;
- mapping;
- helper;
- adapter;
- business rule;

first determine whether the correct behavior can be achieved by fixing or extending an existing canonical abstraction.

Always ask:

> **Am I fixing the cause, or only hiding the symptom?**

If the answer is "hiding the symptom," continue investigating.

---

## 5. Single source of truth

Every important business concept must have a clear canonical authority.

Examples include:

- customer identity;
- property/site identity;
- asset identity;
- employee/technician identity;
- vehicle assignment;
- WhatsApp group identity;
- appointment state;
- work-order state;
- service definition;
- price definition;
- inventory quantity;
- invoice state;
- payment state;
- role and permission definitions;
- schedule definitions;
- message templates;
- product definitions;
- service duration;
- business rules.

Do not create a second source of truth merely because it is convenient.

When data appears in multiple systems, classify each copy as one of:

- canonical authority;
- derived projection;
- cache;
- integration mirror;
- compatibility representation;
- configuration;
- secret;
- temporary migration state.

If two sources disagree and authority is unclear, stop the write path and document the conflict rather than guessing.

---

## 6. Mandatory pre-flight investigation

Before editing, inspect the relevant architecture and search for existing implementations.

At minimum, as applicable, inspect:

- `AGENTS.md` and any nearer `AGENTS.md`;
- `docs/ai/SYSTEM_MAP.md`;
- `docs/ai/AUTHORITY_MATRIX.md` for write-path changes;
- `docs/ai/BUSINESS_RULES.md` for domain changes;
- `docs/ai/KNOWN_FAILURE_PATTERNS.md` for bug work;
- `docs/ai/ARCHITECTURE_DEBT.md` for known structural issues;
- `docs/ai/QUALITY_GATES.md`;
- affected implementation files;
- related tests;
- recent relevant PRs/issues/commits when useful;
- Legacy parity obligations where applicable.

Search for related:

- functions;
- services;
- hooks;
- types;
- schemas;
- constants;
- repositories;
- API clients;
- jobs;
- workers;
- queues;
- listeners;
- webhooks;
- Firebase functions;
- provider adapters;
- environment configuration;
- migration scripts;
- frontend consumers;
- backend consumers.

Do not assume absence because a file has a different name. Search by behavior and domain terminology as well as exact identifiers.

---

## 7. Reuse before creation

Before creating a new abstraction, verify that an equivalent one does not already exist.

Preferred order:

> **Reuse → Extend → Refactor → Create**

Never prefer:

> **Duplicate → Patch → Patch again**

Where two existing implementations represent the same concept, prefer consolidation when safely within scope.

---

## 8. Architecture impact map

Before implementation, build an impact map:

> **Trigger → Domain Logic → Data → Integrations → UI → Side Effects**

Identify:

### Trigger
What starts the behavior?

### Domain logic
Which service or module owns the decision?

### Reads
What records/configuration are consumed?

### Writes
What state changes?

### Dependencies
What other modules depend on the affected data or behavior?

### Side effects
Does the change send messages, generate invoices, modify inventory, create appointments, update schedules, produce notifications, or trigger downstream jobs?

### Integrations
Does it cross Firebase, WhatsApp/Meta, Vercel, GitHub, provider APIs, Legacy, or other services?

### Presentation
Which UI surfaces consume or mutate the same information?

---

## 9. Legacy versus ERP Next

The repository contains distinct product boundaries. Respect them.

- The root application is the Legacy operational fallback.
- `apps/erp-next` is the greenfield ERP for new capability unless a task explicitly requires a critical Legacy repair.
- `functions` is a privileged backend/integration boundary.
- Provider adapters and bridges are integration boundaries, not sources of domain truth.

Do not copy a Legacy patch chain into ERP Next.

Before changing or retiring Legacy behavior, determine whether it is:

- `ACTIVE`;
- `COMPATIBILITY`;
- `MIGRATION`;
- `DEAD`;
- `UNKNOWN`.

`UNKNOWN` blocks removal.

Extract business requirements, data contracts, invariants, permissions, and acceptance tests before replacing Legacy behavior.

---

## 10. Design before implementation

Before coding, be able to state:

### Problem / objective
What is the real business requirement or root cause?

### Current state
How does the system behave now?

### Desired state
What should change?

### Owning layer
Where should the logic live?

### Source of truth
Which system or domain service is authoritative?

### Reuse
Which existing components will be reused or extended?

### Files/systems affected
What is expected to change?

### Data migration
Is existing data compatible?

### Backward compatibility
What old behavior must remain temporarily?

### Risk
What can fail?

### Testing
How will correctness be proven?

### Recovery
How can the change be rolled back or safely recovered?

Only then implement.

---

## 11. Smallest architecturally correct change

Prefer:

> **The smallest change that produces the correct architecture.**

This does not mean the smallest textual diff.

If four callers fail because one shared source is wrong, correct the shared source rather than adding four local exceptions.

Avoid broad rewrites when a narrow coherent change is sufficient, but do not preserve an obviously incorrect authority boundary just to keep the diff small.

---

## 12. Implementation standards

During implementation:

- keep naming consistent;
- keep domain rules out of presentation components;
- keep provider-specific logic out of domain logic;
- avoid hardcoding operational values where configuration or canonical data already exists;
- avoid hidden side effects;
- validate writes at the service/data boundary;
- maintain idempotency where retries are possible;
- preserve observability for critical operations;
- preserve compatibility intentionally, not accidentally;
- use explicit error handling;
- keep security enforcement server-side or at the data-access boundary;
- do not weaken quality gates to make a build pass.

Writing the code is not the end of the task. It begins the validation loop.

---

# 13. Mandatory Four-Pass Review Loop

Every significant implementation must complete four deliberate review passes before it can be considered production-ready.

These passes may be performed by the same builder as self-review lenses, but they do **not** replace the separate Builder/Reviewer evidence required by `AGENTS.md`.

---

## Pass 1 — Correctness Review

Check:

- Does the implementation satisfy the acceptance criteria?
- Are there logical errors?
- Are invalid states possible?
- Are edge cases handled?
- Can the operation execute twice accidentally?
- What happens when an external API fails?
- What happens when required data is missing?
- What happens with older records?
- What happens under concurrent execution?
- Are retries safe?
- Are error paths explicit?
- Do tests represent actual expected behavior?

Correct all material issues before continuing.

---

## Pass 2 — Architecture Review

Review the implementation as an architect.

Check:

- Is the logic in the correct layer?
- Did this create a second source of truth?
- Was an existing abstraction duplicated?
- Is responsibility duplicated?
- Is the new feature unnecessarily coupled?
- Is configuration placed correctly?
- Can the design scale without fixed assumptions?
- Did the change introduce technical debt that can be avoided now?
- Can obsolete code be safely consolidated or removed?

Refactor when the architecture is materially weaker than the available alternative.

---

## Pass 3 — Integration & Regression Review

Review beyond the edited files.

Check impacts on:

- ERP Next;
- Legacy;
- Firebase/backend;
- frontend clients;
- Vercel/deployment configuration;
- WhatsApp/Meta integrations;
- scheduled jobs;
- workers/queues;
- APIs/webhooks;
- authentication and authorization;
- inventory;
- appointments/work orders;
- invoices/payments;
- customer/property/asset identity;
- any known parity obligations.

Run applicable:

- unit tests;
- integration tests;
- regression tests;
- lint;
- type checking;
- build;
- security checks;
- manual scenario verification.

Do not mark a regression as acceptable merely because it is outside the edited file.

---

## Pass 4 — Simplification & Production Readiness Review

Review as a senior engineer who did not author the first draft.

Ask:

> **If I were designing this today with everything I now know, would I still choose this architecture?**

Then inspect:

- simplicity;
- readability;
- maintainability;
- scalability;
- observability;
- security;
- performance;
- operational recovery;
- documentation;
- deployment ordering;
- data compatibility;
- remaining dead code;
- temporary debugging artifacts;
- obsolete fallbacks;
- unnecessary variables/functions;
- unresolved TODOs that belong in the current scope.

If a clearly superior design is available at reasonable scope and materially reduces future risk, refactor before declaring readiness.

---

## 14. Testing requirements

Compilation alone is never sufficient evidence.

As applicable, test:

- happy path;
- invalid input;
- empty/missing input;
- duplicate execution;
- retries;
- timeouts;
- provider failure;
- missing database records;
- Legacy records;
- new records;
- concurrent execution;
- authorization boundaries;
- different roles;
- timezone behavior;
- scheduling behavior;
- frontend/backend consistency;
- idempotency;
- migration behavior;
- rollback/forward recovery.

Critical automations must specifically test duplicate execution and partial failure.

---

## 15. Data consistency review

For any data-model change, explicitly verify:

### Schema
Which canonical model owns the field?

### Existing records
Will old records remain valid?

### Migration
Is migration required?

### Defaults
How are missing fields handled?

### Synchronization
Which other systems hold derived or compatibility copies?

### Conflict resolution
Which authority wins if values disagree?

### Cleanup
Does an old field become obsolete?

Never leave two fields representing the same concept without an explicit migration or compatibility strategy.

---

## 16. Configuration consistency

Classify values correctly as:

- secret;
- deployment configuration;
- domain configuration;
- dynamic operational state;
- derived data;
- business rule.

Do not scatter the same operational rule across code, `.env`, Firebase, GitHub, Vercel, dashboards, and frontend configuration.

Centralize by authority and expose through controlled interfaces.

---

## 17. Observability

Critical operations must be diagnosable without waiting for a human to report that something did not happen.

As appropriate, provide:

- structured logs;
- execution identifiers/correlation IDs;
- start/completion state;
- timestamps;
- failure reason;
- retry count/state;
- audit trail;
- relevant business identifier;
- reconciliation information.

This is especially important for messaging, schedules, payments, invoices, inventory, webhooks, and background jobs.

---

## 18. Idempotency

Any process that can be retried or triggered more than once must be reviewed for idempotency.

Examples:

- daily technician schedules;
- appointment confirmations/reminders;
- WhatsApp messages;
- payment processing;
- invoice generation;
- inventory adjustments;
- webhooks;
- scheduled/background jobs.

Repeated execution must not silently duplicate business effects.

---

## 19. No hidden business logic

Business rules must live in canonical domain/service layers, not be independently reimplemented across UI components, scripts, cron jobs, Firebase functions, or provider adapters.

If multiple entry points need the same rule, they must consume a common authority rather than maintain copies.

---

## 20. No-assumption policy

Do not delete or rewrite unusual code merely because it looks wrong.

Investigate:

- who calls it;
- what dependency it satisfies;
- why it was introduced when evidence is available;
- whether it is still active;
- whether it is compatibility code;
- whether hidden external integrations depend on it.

Classify unknown behavior instead of guessing.

---

## 21. Root cause before fix

For bugs, trace:

> **Symptom → Trigger/Event → Invalid State → Data → Logic → Root Cause**

Fix as close to the root cause as safely possible.

A UI symptom is not automatically a UI problem. A messaging symptom is not automatically a provider problem. A missing record is not automatically a database problem.

Follow the evidence.

---

## 22. Scalability

Do not encode current operating size as permanent architecture.

Avoid fixed assumptions such as exactly four vans, exactly seven technicians, a fixed number of teams, a fixed number of service types, or a fixed number of locations unless the constraint is an explicit configurable business rule.

Design reasonable paths for growth in:

- employees;
- technicians;
- vehicles;
- customers;
- properties/assets;
- appointments;
- inventory;
- invoices;
- messages;
- roles;
- agents;
- integrations;
- locations.

---

## 23. Security review

Before declaring readiness, verify as applicable:

- authentication;
- authorization;
- role enforcement;
- data isolation;
- secrets and credentials;
- PII exposure;
- log safety;
- backend validation;
- Firestore/Storage rules;
- webhook verification;
- CORS;
- least privilege.

Never rely on frontend visibility as authorization.

---

## 24. Deployment safety

Before integration or production deployment, verify:

- required tests pass;
- build passes;
- lint/type checks pass where applicable;
- migrations are safe and idempotent;
- environment configuration exists;
- backward compatibility is understood;
- deployment ordering is defined;
- recovery/rollback is defined;
- security implications are approved;
- production-impacting actions have required human approval.

Do not deploy simply because code review is complete.

---

## 25. Cleanup requirement

When a new implementation replaces an old one, explicitly decide whether the old implementation is:

- removed;
- migrated;
- deprecated;
- retained temporarily for compatibility.

Do not add a new path and leave the old path active indefinitely without a documented reason.

The long-term objective is reduced complexity.

---

## 26. Documentation requirement

For significant changes, document:

- what changed;
- why;
- architectural ownership;
- source of truth;
- important dependencies;
- tests/evidence;
- migration behavior;
- known limitations;
- remaining risk;
- technical debt discovered outside scope.

Use ADRs for durable architectural decisions as required by repository guidance.

---

## 27. Avoid the "now there is a better way" cycle

Before calling a change complete, ask:

> **Is there a clearly superior solution that should reasonably be implemented now, before integration?**

This is not a request for infinite optimization.

Evaluate:

- simplicity;
- maintainability;
- extensibility;
- security;
- consistency;
- migration cost;
- operational risk;
- future change cost.

Stop when additional redesign produces little material risk reduction or value.

---

## 28. Stop condition

The four-pass loop is deliberately finite.

A significant implementation may be considered ready for independent review only when:

- acceptance criteria are satisfied;
- no material known correctness issue remains;
- architecture is coherent;
- sources of truth are explicit;
- meaningful duplication was avoided or documented;
- required tests/checks pass;
- integration/regression impact was reviewed;
- security boundaries were considered;
- migration/recovery behavior is defined where needed;
- the code is reasonably maintainable and scalable;
- remaining risk is documented.

The target is **production-ready engineering quality**, not theoretical perfection.

---

## 29. Mandatory execution sequence

For significant development work, follow this order:

1. **UNDERSTAND** — translate the request into business outcome and acceptance criteria.
2. **INVESTIGATE** — inspect architecture, code, data authority, tests, and history.
3. **MAP** — map dependencies, writes, side effects, and integrations.
4. **DIAGNOSE** — identify root cause or architectural requirement.
5. **DESIGN** — select authority, boundaries, reuse strategy, risks, tests, and recovery.
6. **IMPLEMENT** — make the narrowest coherent change.
7. **REVIEW PASS 1** — correctness.
8. **REVIEW PASS 2** — architecture.
9. **REVIEW PASS 3** — integration/regression.
10. **REVIEW PASS 4** — simplification/production readiness.
11. **TEST** — execute all applicable quality gates.
12. **CLEANUP** — remove accidental duplication, debugging artifacts, and obsolete paths in scope.
13. **DOCUMENT** — record durable decisions and remaining risk.
14. **INDEPENDENT REVIEW** — obtain Builder/Reviewer separation required by `AGENTS.md`.
15. **INTEGRATE** — merge/deploy only through the authorized process.

In condensed form:

> **INVESTIGATE → UNDERSTAND → MAP → DIAGNOSE → DESIGN → IMPLEMENT → REVIEW → REFACTOR → TEST → REVIEW AGAIN → VALIDATE INTEGRATIONS → SIMPLIFY → DOCUMENT → INDEPENDENT REVIEW → INTEGRATE**

---

## 30. Pre-change report for meaningful risk

Before a sufficiently risky change, provide or record:

- **Current State** — what exists now;
- **Finding** — relevant evidence;
- **Root Cause / Requirement** — actual problem or goal;
- **Proposed Architecture** — planned solution;
- **Files / Systems Affected** — expected blast radius;
- **Source of Truth** — canonical authority;
- **Risk Level** — Low / Medium / High;
- **Regression Risk** — what could be affected.

Proceed without unnecessary ceremony for low-risk changes, but never skip the underlying analysis.

---

## 31. Final engineering report

For significant tasks, report:

### RESULT
What was implemented.

### ROOT CAUSE / OBJECTIVE
What problem was solved.

### ARCHITECTURE
Where the behavior now lives and why.

### SOURCE OF TRUTH
What is authoritative.

### CODE CHANGED
Principal files/components changed.

### REMOVED / CONSOLIDATED
Duplicated, Legacy, obsolete, or parallel paths eliminated or intentionally retained.

### TESTS
Exact validation performed.

### FOUR-PASS REVIEW
- Pass 1 — Correctness
- Pass 2 — Architecture
- Pass 3 — Integration/Regression
- Pass 4 — Production Readiness

### RISKS
Remaining known risk.

### TECHNICAL DEBT
Related debt discovered but intentionally left outside scope.

### DEPLOYMENT STATUS
One of: not ready / ready for review / ready for staging / ready for production, subject to required approvals.

Never say "done" or "production ready" based only on code generation.

---

## 32. Scope discipline

Classify discovered issues as:

- **BLOCKER** — must be fixed for this task to be correct/safe;
- **RELATED** — reasonable to include because it directly supports the task;
- **TECHNICAL DEBT** — document for later;
- **UNRELATED** — do not touch.

Do not turn a narrow change into an uncontrolled rewrite.

---

## 33. Golden rules

- **Investigate before coding.**
- **Understand before modifying.**
- **Root cause before patch.**
- **Architecture before implementation.**
- **Reuse before creating.**
- **Refactor before duplicating.**
- **One concept, one canonical authority.**
- **Domain rules belong in canonical domain/service layers.**
- **Test behavior, not only compilation.**
- **Review integrations, not only edited files.**
- **Preserve compatibility intentionally.**
- **Remove obsolete code only with evidence.**
- **Design for reasonable future scale.**
- **Document durable architecture decisions.**
- **Do not confuse "working" with "production ready."**

---

## 34. Final directive

Do not operate as a simple code generator.

For DEMAC development, apply the review lenses of:

- software architecture;
- senior software engineering;
- backend engineering;
- frontend engineering;
- database/data modeling;
- integration engineering;
- QA;
- security;
- DevOps/production readiness.

The engineering responsibility is complete only when there is sufficient evidence that:

> **The correct behavior is implemented in the correct layer, using the correct authority, without unnecessary duplication, without creating uncontrolled parallel truth, and without known unaddressed regressions in the affected system.**
