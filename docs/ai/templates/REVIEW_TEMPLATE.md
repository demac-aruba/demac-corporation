# Engineering Hardening Review: <accepted change>

This review normally occurs **after PRODUCT ACCEPTED**, not during every prototype iteration.
HIGH-risk work may require earlier review of critical boundaries.

## Product acceptance baseline

- Accepted product behavior:
- Owner acceptance evidence/date:
- Diff/commit reviewed:
- Risk class: LOW / MEDIUM / HIGH

## Review mode

- [ ] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent:
Implementation author / agent:

If Solo Maintainer Adversarial Review is selected, the same person or agent may appear in both
fields. This review must remain a fresh adversarial pass and must not be described as independent.

## Scope reviewed

- Request/accepted criteria:
- Affected callers/integrations:
- Authorities and rule IDs:
- Security/data/financial boundaries:

## Hardening checklist

- [ ] Canonical authority / duplicate-source review
- [ ] Domain layering / prototype-shortcut cleanup
- [ ] Affected callers and integration behavior
- [ ] Permissions/security/privacy
- [ ] Data/history preservation
- [ ] Retry/concurrency/idempotency where applicable
- [ ] Failure/recovery/partial-success behavior
- [ ] Performance/scalability where applicable
- [ ] Regression evidence
- [ ] Documentation/rules/parity/debt/ADR evidence updated where required
- [ ] Owner-accepted visible behavior preserved, or product review repeated for required changes

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Critical/High/Medium/Low | | | |

## Verification

- Product-review checks already completed:
- Final required checks run:
- Results:
- Unverified areas:

## Decision

- [ ] Pass — eligible for final Release Gate
- [ ] Pass with recorded follow-up
- [ ] Block / changes required

Residual risk, owner, and due date:

Human approval still required before any action covered by the repository Human Approval Boundary:
