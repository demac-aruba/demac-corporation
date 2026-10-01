# Technician procedure client capture — bounded continuation

## Task / authority

Owner continuation: PR #526 comment 5836339893, 25 September 2026. Develop on
`feature/technician-app-20260923`; no merge, deployment, catalog activation, new
permissions, production-data access or public-preview prerequisite. The original
Standard Service 14 indoor / 9 outdoor contract remains authoritative.

Mode: **Deep Review**, because durable media retries and identity/concurrency are
material recovery boundaries. Review method: Solo Maintainer Adversarial Review,
not independent review. This record does not declare the complete app releasable.

Existing authorities: Firebase Auth/canonical user profile; Field Operations
Authority's current assignment and day boundary; existing workVisits,
workInterventions.procedureWorkflow, fieldEvidence and private procedure media.
The new IndexedDB database is browser-local recovery storage, not a new business
source of truth. Existing generic text outbox/schema is unchanged. No token,
public media URL, binary/base64 in business documents, or fabricated evidence.

## Bounded client transport/storage increment

- Project the actual server workspace with exact target, versioned 14/9 lists,
  step state/readiness, original evidence provenance, safety, risk and pending captures.
- Share the existing authenticated JSON authority adapter; execution never enters
  the generic offline command outbox or claims cached success.
- Persist Blob, hash, original-user/context and stable request IDs before sending.
  Separate local/reserved/uploaded/confirmed. Only a verified server evidence link
  permits removal of local bytes. The exact request is persisted before its first
  transmission; a lost response never becomes a new reservation or upload overwrite.
- Use optimistic local revisions for concurrent tabs. Revalidate assignment,
  author and safety before first reservation; do not rebase a transmitted command.
  Changed coordination retains the original for governed recovery rather than
  relabeling it as an earlier observation.
- Private reads verify type, size and SHA-256 and reject identity changes before
  returning bytes. Scope/revocation failures preserve pending captures.
- A never-sent local capture can be discarded; any persisted reservation intent
  blocks this local deletion path. Historical evidence has no hard-delete control.
- Text drafts have their own revision and survive reload; stale writers conflict.
  Browser quota/persistence limitations must be visible in the connected UI.

## Verification for this increment

Local: strict TypeScript of the affected library graph, script syntax, diff check;
32 projection/provenance cases against actual backend command response shapes.
The managed local browser cannot navigate HTTP by policy; no bypass is attempted.

Added required isolated browser gate (Chromium and WebKit): actual IndexedDB and
client adapters, actual backend commands/private media implementation, synthetic
identity/database/bucket. Tests cover reload, offline, wrong-account access,
loss of reservation/upload/link responses, exact retries, private read integrity,
malformed acknowledgement, revocation, changed safety, late identity changes,
simultaneous tabs, local-only discard, quota failure and text draft conflict.
This is not a hosted backend, physical-phone or codec/playback acceptance.
Exact-head remote results must be recorded in the PR after the run completes.
All previously required gates remain intact.

## Separate adversarial self-review / remaining work

Builder checks: no production/config/rules changes; parser cannot accept another
asset's media; frozen retry IDs are committed before network writes; upload success
alone does not release local bytes; requests never continue as a replacement account;
server still controls ownership, exceptions, safety, finalization and Office review.

A fresh adversarial pass is required after integration. The procedure UI, safe draft
editing and correction recovery, anomaly/add-on access, finalization and Office
integration are subsequent blocks. Green tests for this transport/storage increment
alone do not prove any of those screens complete. No release-readiness claim.
