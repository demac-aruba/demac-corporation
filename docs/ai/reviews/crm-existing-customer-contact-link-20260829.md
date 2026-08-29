# Review: Link an existing CRM customer as a property contact

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: `/root/relationship_model_review`, `/root/security_review`, and `/root/final_qa`

Implementation author / agent: `/root` with separate frontend and backend implementation passes

The relationship-model, security, and final-QA reviews were performed without editing the implementation under review.

## Scope reviewed

- Request/acceptance criteria: Search for an existing canonical customer while adding a commercial/property contact, link that person's identity without duplicating it, and retain the manual new-contact path.
- Diff/commit: PR #465, code head `0ca2229a6e3668c1a3d4d0f7ff28468572bad39a` before this evidence-only documentation update.
- Affected callers/integrations: CRM Customer 360, Office Booking Authority master-data mutation, canonical contact directory, property contact assignments, and appointment recipient resolution.
- Authorities and invariants: `clients` remains the identity owner; `contacts` stores only the relationship bridge; `contactPropertyAssignments` owns role, scope, property, and communication responsibilities; historical appointment recipient snapshots remain immutable.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| High | Canonical recipient fallback | The first security review found that an invalid canonical assignment could fall back to stale legacy `property.contacts` data and notify the wrong person. | Corrected recipient resolution so legacy fallback is allowed only when no relevant canonical assignment exists. Regression tests cover missing/inactive bridges and stale legacy recipients. |
| High | Linked identity projection | The first security review found two paths that could reuse copied contact fields when the linked source customer was missing. | Removed projection-field fallback. Missing linked customers now produce sanitized inactive relationships in backend and Live CRM hydration. |
| Medium | Identity-source ambiguity | An early review found combinations such as `contactId` plus manual contact data were not uniformly rejected. | Enforced exactly one identity source among existing contact, linked customer, or manual contact payload, including empty-object edge cases. |
| Medium | Source usability | An active source record without a usable name/company and communication channel could previously be linked. | Require a canonical name/company plus at least one phone, WhatsApp, or email channel. Added focused rejection tests. |
| Medium | Property ownership | The initial test matrix did not prove that a property owned by another customer was rejected. | Added a server-side ownership rejection test and confirmed no writes occur. |
| Low | Combobox interaction | Independent UI review found Escape and blur behavior could leave the customer-search popup open or make mouse selection unreliable. | Corrected Escape ordering, blur closure, and result mouse-down behavior while retaining keyboard combobox semantics. |
| Low | Manual-contact collision | A selected customer may match an older manually entered contact by phone or email. Automatic merging would risk joining different people and rewriting relationship history. | Intentionally do not auto-merge. Record a future explicit, audited reconciliation flow as a nonblocking recommendation. |

## Verification

- Local automated checks:
  - ERP Next `npm run typecheck` — PASS.
  - ERP Next `npm run test:crm` — PASS; production guard scanned seven files and canonical CRM acceptance passed.
  - ERP Next `npm run test:live-scheduling` — PASS.
  - Affected Office Booking Authority and contact-directory suite — PASS, 59/59.
  - Firebase `npm run validate:firebase` — PASS.
  - Scoped `git diff --check` — PASS.
- Security and permission cases:
  - Office Booking Authority authentication and role allowlist remain mandatory.
  - Self-links, missing/inactive/unusable sources, ambiguous identity sources, linked-identity edits, inactive/wrong-owner properties, and unauthorized callers are rejected without partial writes.
  - Linked identity is read live from `clients/{linkedCustomerId}` and is never copied into the relationship bridge.
  - No Firestore rule, secret, credential, or permission expansion is included.
- Business-invariant cases:
  - A residential customer may also be a commercial-property contact without inheriting or moving properties, work orders, equipment, balance, or history between customer graphs.
  - Deterministic relationship and assignment IDs make retries reuse the same records and preserve creation evidence.
  - Manual contact creation remains explicit and compatible.
  - Historical appointment recipient snapshots are not rewritten.
- Build/deployment evidence:
  - Local Next.js compilation reached successful compile and TypeScript validation, then the Windows sandbox denied a worker spawn with `EPERM`; remote CI/Vercel is the authoritative production-build gate.
  - GitHub `TypeScript and web build validation` run `33258483092` — PASS.
  - GitHub `Office Booking Authority` run `33258483080` — PASS.
  - GitHub `ERP Next CI` run `33258483117` — PASS.
  - GitHub `Customer Agent Architecture` run `33258483082` — PASS.
  - GitHub `Transactional WhatsApp Production` run `33258483083` — PASS.
  - Vercel web preview `dpl_HftovJeqY7vyLAm4ojs1s4ST8LUW` — READY.
  - Vercel core preview `dpl_75fRAgZqNXyo1DrrtN5G9UQGquDE` — READY.
  - Production deployment and runtime inspection are post-merge gates; completion will not be reported to the owner until both are verified.
- Unverified areas:
  - The local in-app browser has no authenticated DEMAC production session, so the owner must perform the final authenticated interaction smoke after deployment.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

Independent security re-review: PASS, no remaining blockers.

Residual risks and follow-up:

- `saveContactAssignment` uses deterministic record IDs but does not yet persist a global request-id conflict ledger or request correlation on every mutable assignment; this is nonblocking for this feature and should be addressed with a broader authority audit/idempotency design rather than a feature-local collection.
- Recipient resolution and a later appointment transaction can observe a customer deactivation at different instants; the existing notification authority remains responsible for revalidation at send time.
- Existing default reminder/arrival consent behavior and the pre-existing token/profile fail-closed consistency concern were not changed by this feature.
- Authenticated production UI smoke: DEMAC owner immediately after the approved merge/deployment.
