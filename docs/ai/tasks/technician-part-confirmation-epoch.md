# Task — part confirmation after interrupted responses

## Scope and classification
Continue the approved Field portal task on `feature/technician-app-20260923`, PR 526, starting at exact remote source `63f6416b6666a9e43c1378730fa5549daf2c48dc`. Deep Review applies to stale coordination and retry. This narrow change does not add authority, alter authentication, expose files, change business rules, or deploy anything.

The part selector must not mark coordination current when a write response arrives after an intervening offline/hidden event. Preserve the received server result, but require a fresh authorized read before enabling another operation. Existing Field Operations Authority, FIELD-DAY-001, CRM-LOCATION-001, server version checks, audit, and responsible-only global transitions remain unchanged.

## Implementation
Capture the request epoch at the beginning of an explicit mutation. Accept its acknowledgement as fresh only if that epoch still matches and the browser is online and visible. The existing context-keyed component and per-user adapter still reject old-account responses. Add a browser regression that holds a successful response across an offline/online cycle, then checks that a subsequent action remains disabled until a new read. Add the exact executed Git head to the browser report.

The previous CI run `36093585424`, job `107941022276`, stopped at full Next.js typecheck: the synthetic fixture lacked `emailVerified`. Explicitly include that metadata on the local test-session object, without changing the real session contract or authentication behavior. The exact-head archive's `session.ts` type does not itself require this property; this discrepancy is recorded rather than treated as proof that the production contract changed. A separate inferred object is structurally compatible with both shapes without a cast or suppressed type error. The metadata describes a synthetic fixture only, not an actual verified email or an authorization claim.

## Acceptance and verification
- A late write after an interrupted confirmation remains visibly unconfirmed until a fresh read. No local success turns into safety permission, workflow completion, billing, stock, or office approval.
- Keep every existing required gate and original browser assertion. The public isolated-preview gate remains a blocking requirement, not an expected failure to suppress.
- Local focused TypeScript 5.8.3 check of the fixture, component, transport and dependencies passed; Node syntax and `git diff --check` passed. This is not the full Next.js/CI typecheck.
- Exact source artifact `10846597198` for source `63f6416b6666a9e43c1378730fa5549daf2c48dc` was recovered and its ZIP SHA256 `ca0ec34808747bbe3df6536a2103292fa9fb796a1fab9dfa15114cdbb83933c9` and both inner archive checksums verified. All three pre-change file blobs match the published source.
- Actual Chromium rendering of this selector at 360x800, 390x844 and 1365x1000 completed without horizontal overflow or page errors; part touch targets exceeded 44px. This used inline, synthetic, read-only visual fixtures, not the actual HTTP transport. No real-login, browser concurrency, durable media or hosted-preview claim follows from those screenshots.
- The local managed browser blocks network navigation, including loopback. Its policy was not changed or bypassed. Complete Chromium/WebKit transport/concurrency assertions and the full Next.js build remain for exact-head CI.
- The predecessor backend integration is separately verified on source `06e78a95d8be10231a647a52f42eba0dc0560fed`; it is not evidence that this new frontend is fully accepted.

## Separate Solo Maintainer Adversarial Review
Same maintainer, separate inspection after editing; not an independent review. Reviewed the full three-file diff and the active-view target key, read epoch, mutation lock, offline/visibility handlers, adapter UID validation, exact-retry payload, and backend claim/release authority. Challenged: offline then online before acknowledgement, hidden then visible while a write is in flight, an obsolete component unmount, concurrent reads, loss of response after server commit, and permission revocation.

An old write still may supply the last received historical snapshot to its same-context component, but cannot re-enable coordination after epoch invalidation. Current authorization and allowed commands are still checked on each server mutation. Hard failures clear data; transient failure permits explicit same-request replay without inventing a successful outcome. Synthetic session metadata cannot grant server privileges. No new auth cast, typecheck ignore, public URL, side effect or external service was introduced.

Decision: acceptable narrow source correction for branch CI, not release approval. Browser assertions, full app build and hosted preview remain pending. Rollback is source-only before activation; do not erase part history or media as rollback. Keep the PR Draft and do not merge, deploy production, provision IAM/billing, mutate real data or bypass test-environment isolation.
