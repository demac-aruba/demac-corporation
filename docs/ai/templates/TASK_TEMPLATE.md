# Task: <concise outcome>

Use this template in proportion to the task. LOW-risk product iteration may use only the short
sections. MEDIUM/HIGH work should complete the relevant governance/risk sections before release.

## Stage and risk

- Risk: LOW / MEDIUM / HIGH
- Current stage: Authority Check / Prototype / Product Review / Product Accepted / Hardening / Release

## Product intent

- Request/source:
- Product surface/users:
- Desired behavior:
- Current behavior/evidence:

## Authority & Safety Check

- Existing source of truth / owner:
- Write path affected:
- Adjacent modules/integrations:
- Security/financial/destructive/messaging/data risk:
- Why this risk class applies:

## Prototype scope

- In scope now:
- Explicitly deferred until product acceptance:
- Files/boundaries expected:

## Product-review acceptance

- [ ] Primary user flow works:
- [ ] Important failure/denial behavior:
- [ ] Known limitations stated:
- Focused verification:

## Owner product review

- [ ] 🟡 READY FOR PRODUCT REVIEW
- Owner feedback / requested iteration:
- [ ] PRODUCT ACCEPTED
- Accepted behavior/date:

## Engineering Hardening

Complete after product acceptance, or earlier where HIGH risk requires it.

- Authority/source-of-truth review:
- Architecture/layering/integration review:
- Security/privacy/permission review:
- Retry/concurrency/idempotency review:
- Failure/recovery/data-history review:
- Regression coverage:
- Rules/parity/debt/ADR documentation changes:
- Residual risk:

## Final release verification

- Required final automated gates:
- Manual scenarios:
- Evidence/results:
- Not run and why:
- [ ] 🟢 READY FOR MERGE
