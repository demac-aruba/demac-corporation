# Review: Booking backend incident diagnostics

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer: `/root/financial_review`; implementation: `/root`.

## Scope reviewed

- Draft PR #568 diagnostic workflow/script/tests; no product code or production configuration changed.
- Read-only infrastructure inspection around Booking Authority and `OPS-SCHED-CHARGES-001`.
- Runtime health investigation is separate from approval of a corrective release.

## Findings

| Severity | Evidence and impact | Resolution |
| --- | --- | --- |
| High | Copying a matching runtime log line could include private adjacent text. | Fixed before final diagnostic runs: extract only typed technical signals; synthetic-private-text test passes. |
| High | Uncaught command errors could dump captured configuration/stdout/stderr. | Fixed: top-level sanitized failure, nested fixed classification; command-failure test passes. |
| Medium | ACTIVE/Ready and max 100 do not establish available instances or explain 429. | Recorded as unresolved availability; no automatic capacity mutation. |
| Medium | Metrics sampling, pagination and request-count exclusions limit causal claims. | Exact revision filter, larger bounded page, explicit truncation signal; no OOM/traffic-saturation conclusion. |
| Low | A network timeout on one endpoint can prevent later probes in the same run. | Recorded limitation; completed final run returned both endpoints and all origins, so current comparison is valid. |

## Verification and decision

- Independent reviewer verified head `667c573437543c288563fd353ef140720bbe34cd`: 3/3 tests, syntax/diff checks, and a separate full-main simulation with mocked gcloud/fetch covering all seven metrics, exact revision filter, pagination flag, credential destination and sanitized output.
- The API-page coverage flag does not mean every historical sample is printed: output retains the latest 15 nonzero samples per series, not a four-hour memory peak.
- Diagnostics are read-only; anonymous POST uses a read action and contains no customer identity or payment payload.
- No new permissions, secrets, data authority, financial calculations or retry semantics.
- Diagnostic tests PASS. **Production restoration remains BLOCKED/unverified**, because the cause and safe corrective action are not yet established and runtime logs deny read access.
- Do not treat a green diagnostic job as restored service. Do not merge/deploy this draft as an incident fix.
- Residual risk owner: maintainer, next incident response step. Obtain runtime/system failure evidence from an authorized reader and review the exact proposed restoration before release.

See [task and timed evidence](../tasks/booking-runtime-incident-20261011.md).
