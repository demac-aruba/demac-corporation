# Review: Booking references with each WhatsApp work message

Follow-up: [6 October live-workflow audit](20261006-booking-references-live-workflow-audit.md)
supersedes the terminal-failure blocking behavior and adds live-source compatibility,
real transaction-concurrency evidence and guarded retry checks. Its release status is current.

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer / implementation author: Codex, in separate implementation and adversarial
self-review passes. This is not an independent review or human release approval.

## Scope reviewed

- Christian's 2026-10-05 request: optional reference files/explanations/voice/GPS at
  booking and later; actual media in each individual 08:00 Aruba WhatsApp work message.
- Implementation snapshot `015046df` against main `36392f4a`, followed by a separate
  corrective diff for the findings below, final consumer tests and build.
- Entire feature diff and affected creation/facade/special-booking callers, live drawers,
  Field reader, daily/same-day/support producers, queue poll/ACK and deployed-bridge source.
- Authorities: canonical Appointment/Booking Authority, current-day Field assignment,
  existing Communication Authority/queue; `OPS-SCHED-REFERENCES-001`, `FIELD-DAY-001`
  and historical-silence requirements. Firestore/Storage access rules unchanged.

## Findings and corrections

| Severity | Location | Evidence and impact | Resolution |
| --- | --- | --- | --- |
| High | Queue pagination | First 50 rows may all depend on a predecessor outside that page, permanently blocking the batch | Poll scans blocked pages; regression with 60 dependents passes |
| Medium | Recipient coordination | An already claimed ordinary text could overlap the start of a bundle under multiple pollers | All new wacli claims reserve the recipient; ordinary success/failure releases it, bundles retain until final success; regression passes |
| Medium | Recovery | A failed ordinary schedule text in the dependency chain would block later bundles while bundle-only retry ignored it | Office retry includes failed canonical schedule texts, preserves sent state, and honors enabled/current group configuration |
| Medium | Media lease | Three minutes can expire during download, voice conversion, provider send and durable ACK | Bundle lease is ten minutes; plain-text lease unchanged; asserted in gateway test |
| High | Private media / existing queue-create rules | Existing office rules allow creation of ordinary queue records; a crafted media path must not read another operator's unclaimed upload | Retrieval checks the server-owned linked manifest and exact Appointment/path, and uses canonical MIME; unclaimed/foreign-booking tests pass without changing rules |
| Low | Initial read failure | Failed initial load could look like an empty editable reference section | Reader/editor show load failure and retry only until successful load; browser recovery test passes |

No unresolved correctness or authorization finding was found in the final corrective diff.

## Verification

- `npm run validate:firebase --prefix functions`: PASS, including new module syntax.
- `npm run test:booking-authority --prefix functions`: **232 passed**, no skipped tests.
  Includes new reference service/HTTP/gateway tests in the existing CI booking gate.
- `npm run test:transactional-whatsapp --prefix functions`: **119 passed**, no skipped tests.
- `npm run typecheck --prefix apps/erp-next`: PASS.
- `npm run build --prefix apps/erp-next`: PASS, including all mandatory prebuild hooks.
  Initial build rejected an external node_modules symlink; real local dependencies
  corrected the environment. No build hook/gate was skipped or changed.
- `node apps/erp-next/scripts/booking-references-browser.cjs`: **2 scenarios passed**,
  desktop 1280px and dark mobile 320px, actual editor/reader/HTTP client with synthetic
  transport. Covered three media uploads, per-file explanations, ordering, GPS,
  post-booking edit, failed-save preservation/retry, private photo preview, read-only
  technician rendering and failed-load recovery. No external requests/page errors.
  Screenshots were visually inspected. Fixture renders the actual reference panel;
  it does not claim a full authenticated production booking or provider send.
- Agent-browser CLI could not start its daemon in this environment after retry;
  that tool-specific smoke is **unavailable**, not reported as passing. Chromium
  through Playwright supplied the visual and interaction evidence above.
- `git diff --check`: PASS. Next-generated changes to tsconfig/next-env were restored.

Security: active account/office roles, denied technician writes, ownership, cross-booking
reuse, private draft reads, current-day assigned reads, untrusted paths/types/sizes,
wrong/expired-after-ACK delivery tokens, forged draft/foreign-booking media claims and orphan cleanup. Service fixtures assert
that Firestore transactions do not read after writes.

Business: ordinary/special atomic reference claims, immutable booking workload/capacity,
all-day schedule content, per-job ordered captions/voice, support Van updates, historical/
future/pre-08:00/held silence. Existing plain bookings and legacy consumer suites pass.

Recovery: exact create/edit/upload replay; stale expected version; single cursor advance
on duplicate ACK; delayed/bounded part retries; other groups remain available; failed
bundle retains progress; failed schedule retry retains sent IDs and ignores sent/stale
group records. Source inspection confirms the bridge already persists ACKs and sends
native media/voice; its running production version was not inspected or exercised.

## Decision and residual risk

- [x] Pass for human product/release review, with recorded operational limits
- [ ] Human production release approval

No production writes, real group messages, security-rule changes or deployments were
performed. Integration tests use in-memory Firestore/storage and a synthetic HTTP
transport; actual network uploads/codecs/provider delivery still need the approved
release smoke. Owner: release maintainer; due before production rollout.

The external sender remains at-least-once across a provider-send/ACK crash. Large files
increase batch duration; terminal failed bundles pause that group until office retry.
Linked-file retention is intentionally conservative. Poll reads grow with blocked
backlog. See the ADR for monitoring, deployment ordering and rollback: drain/reconcile
pending bundles before reverting to a gateway that cannot interpret them.

Repository `AGENTS.md` requires human approval before merge/production deployment.
