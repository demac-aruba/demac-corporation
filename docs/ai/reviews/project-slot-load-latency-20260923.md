# Review: Current Project slot loading latency

## Review mode
- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review
- Builder/reviewer: Codex. This is a separate adversarial self-review after implementation, not an independent review.

## Scope reviewed
- Complete production diff from 3ef8d37b, the unchanged React refresh/cancellation callers, Project identity/slot projection, existing Firestore auth adapter, workOrders rules and role capabilities.
- Booking Authority remains canonical; OPS-SVC/OPS-TEAM/OPS-SCHED/OPS-STAFF-ATTENDANCE are unchanged. Exact links and all four identity checks remain required before displaying crew.
- No write path, new cache, role/rule/configuration expansion, business calculation, attendance transport or Field workflow change. The branch auto-deployment guard preserves the existing scoped release process.

## Findings and resolution
| Severity | Challenge | Resolution/evidence |
| --- | --- | --- |
| Medium | Batch results may be shuffled, omitted, duplicated or from another path. | Exact full resource-name mapping, duplicate/unrequested rejection, literal ID preservation and own-property checks. Explicit missing alone is null; omitted rows are failed. Negative transport tests pass. |
| Medium | A batch denial could falsely remove all reservations. | Every member remains unverified, not deleted; the existing incomplete indicator withholds an all-clear metric. Synthetic 403/network/malformed/partial recovery checks pass. |
| Medium | Large histories or session changes could cause uncontrolled reads or stale rendering. | At most 20 IDs/request and three requests in flight; pre-abort/in-flight cancellation stop subsequent waves. Unchanged principal/ID/revision React isolation is tested through the real REST adapter in four browser/device combinations. |
| Low | Batching could accidentally conceal backdated corrections with a cache. | No cache added. Repeated transport reads with corrected slot values and full browser reduce/cancel/delete/add/attendance scenarios pass. |

## Verification
- PASS typecheck and complete Next production build, including every mandatory prebuild gate.
- PASS 10 slot-progress acceptance groups, plus real REST serialization/auth header, field mask, bounds, identity, negative permissions, malformed/partial responses, cancellation and recovery tests.
- PASS Chromium and WebKit at 1440px and 390px: first 13 Work Orders produce exactly one REST batch; red 75/66 +9, chronological detail, backdated slot/attendance corrections, removal/addition, focus refresh, failure/recovery, payroll revocation and stale-session suppression. No external network requests or page exceptions. Screenshot inspected.
- PASS 26 existing booking-drawer browser scenarios (13 per engine), live Scheduling/Project labels, Dispatch and appointment lifecycle tests.
- Controlled transport benchmark: 13 links at 100ms simulated response delay changed 13 requests/329ms to 1/108ms; 100 links changed 100/1845ms to 5/219ms; 1,000 links at 20ms changed 1,000/5158ms to 50/532ms. This records local synthetic latency, not production WAN time. Repeated build measurements were comparable.
- CI, staged build and final domain/source checks are recorded in the delivery evidence after the source commit.

## Decision and limitations
- [x] Pass with recorded scope limitations
- Batches use the existing signed-in user's ID token and Firestore Rules; no admin bypass. Batch size does not override provider rule limits. Existing permitted office roles read their same cached user profile under the unchanged rules.
- An error affects verification for that batch (up to 20 links); the next existing refresh retries current data. No immediate retry storm or stale verified fallback is introduced.
- Browser tests mock only auth and Firebase HTTP responses, while exercising the real read adapter and page. No authenticated private production record or actual customer WAN timing was inspected; the connected in-app browser has no existing signed-in tab. Production verification covers the delivered version/assets and route availability.
- No rules/index/backend/migration rollout. Rollback is prior frontend source 3ef8d37b / deployment dpl_DB6niuDGjyHsigSHsc6HdHfmQbK1. Existing owner approval permits merge/deployment after checks. Pending main overtime must remain outside the scoped release.
- API contract: [Firestore batchGet](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/batchGet), [REST authentication and Rules](https://firebase.google.com/docs/firestore/use-rest-api#authentication_and_authorization).
