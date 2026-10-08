# Task — shared Field part selector, incremental and not a hosted preview

## Request and scope
Continue PR 526 on `feature/technician-app-20260923`, from remote source `06e78a95d8be10231a647a52f42eba0dc0560fed`. Owner authorizes branch development and an isolated preview only. No merge, production deployment, billing, IAM, secrets, production data or external tunnels.

Connect the existing active `DetailView` to the canonical procedure workspace and explicit part-claim/release commands. Reuse current AuthProvider, session, Field HTTP transport, canonical visit/intervention/asset identity, server permissions and existing portal chrome. This increment implements the reference-04 selection surface, not procedure/media capture or all of Hito 2. A visible notice states that the detailed multimedia capture screen remains unfinished.

## Mode, authorities, and acceptance
Deep Review for two-user concurrency, private context, stale network responses and exact retry. No new backend authority, data collection, permission or workflow rule. Respect Field Operations Authority, FIELD-DAY-001, CRM-LOCATION-001 and the existing Field audit/immutability policy. New commands are online-only; they are not silently placed in the existing text outbox as offline safety approvals.

Opening or selecting a part performs no write. Explicit claim uses current part version and one stable request ID. A committed request whose response is lost retries the identical request, without duplicate history. Release requires the backend's existing `note` field and preserves authorship. An unknown protocol, malformed response, foreign identity or revoked access never becomes editable. Transient failures retain visibly unconfirmed context; account/target change discards the old component immediately. Offline/hidden views lose confirmation, and late responses cannot restore a different user's view.

## Product and visual limits
All ten original reference PNGs were opened individually before this change. Reference 04 is primary; written corrections override mockup labels and invented identities. Reuse navy tropical header, white rounded context/part cards, blue controls, large touch targets and the four-tab navigation. Use illustrative unit icons and clearly synthetic fixture data, not unverified staff or property photography. Exact fidelity and usefulness still require the owner's first actual hosted preview review. Desktop uses two columns rather than shrinking phone content. No device frame or fake notification UI.

The entry remains inside the current Evidence/report section pending the subsequent full-screen procedures increment. Selecting a part does not mark steps documented, begin the physical visit, create another service, bill anything, clear risk, or grant helper global completion. Other services without explicit versioned protocol metadata remain unsupported by this selector; their existing report flows are untouched.

## Verification at source preparation
- Focused TypeScript 5.8.3 check of the new selector fixture, component, adapter and dependency graph passed, using the actual installed React declarations and a test-only CSS module declaration. This is not the complete Next.js production typecheck.
- Active TechnicianFieldHome bundled successfully with esbuild. Node syntax and `git diff --check` passed.
- Defensive response-projection cases passed against the actual synthetic backend response: 14/9 structure, mismatched visit/intervention/asset, unknown versions/actions/states, malformed ownership and no implicit protocol.
- The new Chromium run could not navigate its local test server: the container-managed browser returns `ERR_BLOCKED_BY_ADMINISTRATOR`. No browser policy was changed or bypassed. Browser assertions and screenshots are pending the existing GitHub isolated runner, not claimed successful locally.
- Added Chromium AND WebKit part tests to the existing preview workflow without removing or weakening any existing test/build gate. The explicit hosted-preview-unavailable failure remains mandatory.
- The predecessor's backend integration DID pass on exact source `06e78a95d8be10231a647a52f42eba0dc0560fed`: run `36092151958`, artifact `10846222335`, verified archive SHA256 `65b38aefc1fdccf7aa7b6540d118b0cf2a0e0058f4bf74e4df1142bb6b4e4816`. All seven manifest files matched the executed source. This proves the synthetic emulator backend flow, not this new UI or hosted availability.

## Risks and recovery
No migration. Keep PR Draft and previous UI/code available. Source rollback before deployment is sufficient; do not erase part history or uploaded objects. Backend remains authoritative if another member takes a part after a read. Reconfirm after network interruption. The persistent binary queue, per-step capture, coordinated completion UI, anomaly/add-on layouts and public isolated backend remain separately unfinished. A monitor can report readiness; it does not build software in the background.

# Separate Solo Maintainer Adversarial Review

Mode: same maintainer, fresh review after implementation; not independent review.

Reviewed the complete changed active-view section, response parser, adapter, selector effects, backend command allowlist, ownership/version checks and existing authentication/caller boundaries. Specifically compared `AuthPrincipal.userId` with Firebase session `uid`, and corrected the release payload to the existing canonical `note` field. Unknown server state cannot be treated as success. The parser accepts a missing employee display label without inventing a replacement identity. Known state counts are presentation, not safety authorization.

Existing full Next.js gates and the new browser scenarios remain required. Outstanding acceptance blockers: actual browser outcomes, compiled active-app route wiring, visual comparison of resulting screenshots, and genuine hosted test isolation. No release approval is asserted. Review must be completed against actual CI artifacts before the selector is described as browser-verified.
