# ADR: explicitly confirmed ERP–QuickBooks identity links

- Status: Accepted for owner-authorized continuation; publication evidence is separate.
- Date: 2026-10-19
- Owners: DEMAC business owner; integration maintainer.
- Task/rules: `../tasks/quickbooks-confirmed-links-20261019.md`, `FIN-QBO-LINKS-001`.
- Partially supersedes: `quickbooks-catalog-20261014.md`, only its no-mapping phase boundary.

## Context

Customers and articles already exist in both systems. Name/email/SKU suggestions cannot
establish identity or justify duplicate creation. The owner asked to continue toward
explicit matching while keeping production accounting unchanged. The reader and encrypted
OAuth lease are already deployed; altering them would unnecessarily expand this release.

## Decision

Add the isolated owner-only `quickbooksLinks` function. It reuses unchanged report catalog
and authorization services, including their fixed GET query, provider limits, refresh
uncertainty marker and shared lease. No second token owner, accounting API or bootstrap
export is introduced. POST refers to commands on the ERP metadata boundary only.

Prepare re-reads canonical `clients`/`services`, version, connection and target claim;
reads one fixed provider page; compares both submitted observation fingerprints; rechecks
the transaction context and creates a five-minute intent. It returns the two verified
identities for explicit UI acknowledgement. Confirm revalidates actor, source, connection,
expiry, version and claim before atomically saving link, target claim, history and consumed
intent. It performs no provider request. A concurrent provider edit during the bounded
observation window is possible: this metadata is never sufficient authority for a send.

One active target per ERP identity and one active ERP identity per target, scoped to
Customer/Item and the fixed production company. Exact retries are idempotent. Replacing a
target requires revoke first. Revoke releases the claim, increments version and appends
history; it does not delete business records. Inactive records, subcustomers/projects,
groups and incompatible item types fail closed. Corrupt/missing active claims are blocked.

Private paths below `integrationPrivate/quickbooksProduction` are `catalogLinks/{hash}`,
`catalogLinkTargets/{hash}`, `catalogLinkIntents/{random}`, and per-link `history/{version}`.
Persist IDs, hashes, actor/time, version and connection identity only. Default-deny rules
remain unchanged. These are integration coordination records, not another customer,
service, inventory or accounting source of truth. List is bounded to 100 requested ERP IDs;
source/connection drift and client-observed provider drift require review.

## Alternatives considered

| Alternative | Benefit | Rejection |
| --- | --- | --- |
| Auto-accept name/SKU matches | Fewer clicks | Can associate the wrong customer or item. |
| Modify deployed reader endpoint | One fewer function | Mixes read and persistent authority; expands release risk. |
| Many ERP identities per target | Handles duplicate ERP records | Requires explicit duplicate/hierarchy policy absent in this phase. |
| Re-query QBO during confirm | Fresher observation | Cannot make two systems atomic; short intent plus mandatory future-send revalidation has a clear limit. |

## Consequences

- Positive: explicit review, deterministic uniqueness, retained history, safe retry and recovery.
- Tradeoff: bounded provider observation is not a stable snapshot; new intent needed after
  five minutes or drift. Source page changes require catalog refresh. OAuth/rate limits
  can temporarily block prepare. One-to-one and hierarchy constraints may need later policy.
- Privacy: no business payloads in link records, diagnostics or browser storage. Intent and
  history metadata are retained; a future separately reviewed retention policy is required
  if volume increases. No TTL or cleanup migration is included.
- Operations: list reads are chunked at 100, provider scans retain existing spacing, controls
  remain disabled until metadata loads. Disconnect hides access; reconnection changes
  connection version and makes existing confirmed identities review-required.
- Compatibility: no CRM/service schema, Firestore rules, operational entry, payment or
  invoice workflow changes. Existing invoice/WhatsApp fixes are preserved.

## Verification and rollout

Backend tests cover owner denial, stale sources/connection, target races, same-source CAS,
replay, expiry, corruption, inactive/type restrictions, provider lease and privacy. Frontend
adapter tests check fingerprints and response/session validation; desktop/mobile browser
fixtures check review, acknowledgement, double click, persisted reload, revoke and lost
response. Synthetic tests do not establish real customer identity.

Deployment pins unchanged reader/auth dependencies plus the reviewed new implementation,
verifies current installed source/revisions and owner/realm, and installs only the new
function. It verifies exact published source, anonymous denial probes, unchanged inventory
of other functions and authorization metadata. A retry verifies an identical installed
function only; an unexpected existing source is rejected. Merge uses `[merge-only]` and
`[deploy-qbo-links]`; production frontend follows backend verification.

Recovery: restore the previous frontend deployment to hide the new commands; retain saved
metadata/history. Do not delete/rewrite links or change rules/credentials as rollback. If a
new backend correction is needed, inspect the installed revision and use a separately
reviewed isolated update; this installer will not overwrite an existing different source.
Review triggers: first real identity confirmation, any hierarchy/many-to-one request,
retention volume, or any proposed accounting consumer. Future sends must revalidate live
identities, mappings/versions, currency, taxes, accounts, prices, units and cutoff policy.
