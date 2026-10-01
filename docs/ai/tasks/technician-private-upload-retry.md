# Task: replay an existing private Field capture without a second write

## Context
- Request: continue the Technician/Helper portal on PR 526 and notify the owner when a genuine isolated preview is ready. The owner's master request sections 11 and 17 require exact retry, preserved original evidence and truthful acceptance.
- Product: existing Field Operations private procedure media; responsible and helper accounts keep their current scoped authority.
- Exact starting head: `0953061644a176a105b11f2e82e0905156f55f8a`, task branch `feature/technician-app-20260923`. The latest integration run `36089032946` failed at indoor I01 with a replay assertion. It remains failed; this change does not retroactively call it successful.

## Scope
- Implement a verified read-only fast path for an already uploaded capture. Preserve the atomic create-only Storage precondition for first-upload races.
- Add regression coverage for repeated upload, existing conflicting bytes, metadata failures, original disappearance, concurrent create, competing different bytes and lost successful-upload responses.
- Do not modify public API contracts, Field permissions, Office Review, catalog prices, Booking, Firebase rules, production configuration, dependencies or required integration assertions.

## Governance
- Deep Review: private evidence and retry/concurrency.
- Authorities: Field Operations Authority, its existing assigned-principal resolver, canonical WorkVisit/WorkIntervention, `fieldEvidence`, `fieldOperationEvents`, existing private Storage path.
- Protected rules: `FIELD-DAY-001`, `CRM-LOCATION-001`, existing Field audit/idempotency and evidence privacy boundaries. No business-rule change or new source of truth.
- Legacy parity/ADR: no Legacy write path or architecture decision changes.

## Acceptance criteria
- An exact repeated upload returns the original generation and hash as `replayed:true`, `linked:false`, with no second Storage save.
- A conflicting existing file is never replaced. Only a definite initial metadata 404 permits a create attempt; transport/access errors and a disappearing pinned original do not permit recreation.
- First uploads retain `ifGenerationMatch:0`; a competing creator is resolved by verifying the winning original, not by overwriting or trusting metadata alone.
- Upload success is not evidence-link success. The existing authenticated `commit_media` command, audit and Office closure guards remain unchanged.
- Full integration must pass on the exact remote commit before declaring the earlier integrated failure corrected. A hosted preview remains a separate acceptance condition.

## Plan, risks and recovery
The existing endpoint authenticates and validates a canonical reservation before touching Storage. Validate the incoming bytes against that reservation, inspect an existing object and read its exact generation, then compare actual verified bytes/type/size to the reservation. Otherwise attempt the existing create-only save and verify the resulting object. Do not add automatic replacement, public URLs, sleeps or generic retry loops.

This adds one metadata lookup before a first upload. Ordinary retry trades an unnecessary failed save for a bounded private read, still needed to validate the bytes. GCS create preconditions remain necessary because the preflight read alone is not a concurrency lock. Local fake Storage validates that precondition; it does not prove real-service behavior. No claim is made here that Firebase Emulator implements every GCS condition.

No migration or data change. Source rollback is possible before activation; preserve private-object and canonical-evidence readers and never delete originals as rollback. Deployment and activation remain separately authorized.

## Builder verification
- All 19 original media tests were preserved unchanged. Nine additional regressions bring this suite to 28/28 passing.
- Red/green check: the new suite against the original media implementation produced 21 pass / 7 fail. The patched implementation restores 28 pass / 0 fail. No assertion was weakened to make it pass.
- `npm run test:field-authority --prefix functions`: 424 main tests pass, plus the unchanged six pretest groups (5,18,10,4,5,5).
- `npm run validate:firebase --prefix functions`: pass. `git diff --check`: pass.
- Tests used Node 22.16.0 and synthetic local fixtures. Actual emulator integration is delegated to the existing no-secret GitHub CI workflow after this commit; not reported as passed in this record.
- Local working copy was recovered from exact-head artifact `10844779200`, ZIP SHA256 `1c0d74f690bc2ed219eb79093e4a8a7042487d6c0e474d20162489227fd17b01`, with inner checksums verified. No source was guessed from a stale archive.

# Separate review: private upload retry

## Review mode
- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review
Builder and reviewer: same ChatGPT maintainer, separate inspection after implementation. No independent review is claimed.

## Scope reviewed
Reviewed the complete two-file diff, all original/new assertions, the HTTP media caller and its canonical `authenticate` path, `authorizeUpload`, `commit_media`, pinned-generation readers and current Office locking. Compared the change against the owner's preserved-original and partial-failure requirements and the authority/rule boundaries above.

## Findings
| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Medium, addressed | Ordinary upload retry | The original implementation attempted a save on every retry and relied on 412; ordinary retry now verifies the existing generation before any save. Seven new assertions fail against the old implementation. | Implemented with original create-only race guard retained. |
| Acceptance blocker | Exact-head emulator and hosted preview | Local unit tests cannot establish the full integrated path or public isolated availability. Prior integration and public-preview gates are not waived. | Record actual new CI outcome; keep PR Draft and do not present a preview until independently verifiable availability/isolation evidence exists. |

## Review verification
- Validated that unauthorized, different-owner and anonymous requests still fail before store access through existing tests/callers.
- Challenged same and different concurrent creators, 403/429/503 metadata failures, pinned original disappearance, byte corruption and lost response. The only handled initial-read failure is 404; pin-read failures propagate. Atomic `ifGenerationMatch:0`, CRC32C, content signature/type limits and SHA256 comparisons remain.
- Existing audit, link transaction, workflow versions, responsibility, safety decisions and commercial effects are unchanged. Upload response remains explicitly unlinked.
- Rechecked unchanged original test statements and full Field/syntax gates. No source includes credentials, customer data, new provider or production write/deploy.

## Decision
- [ ] Complete portal / release approved
- [x] Narrow source change acceptable for task-branch CI; integrated acceptance still blocked pending the actual run.
Residual risks: emulator-vs-GCS differences, hosted test project availability, persistent browser multimedia queue and full visual/role workflow are unverified. Owner: maintainer; resolve before preview or release acceptance. The owner must separately approve any merge, production deployment, access change or billing action.
