# Review: Booking service availability incident

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer: `/root/booking_followup_review` (this record only; no implementation or production changes).
Investigation author: `/root`.

## Scope reviewed

- Owner reports failed contact-directory and scheduling-service requests after #566. Restore existing availability while preserving authentication, roles, Booking Authority, canonical customer/property/contact identities, pricing and the deployed Field helper guard.
- Diagnostic tree: `c112a8ba7dc2dcaa0300e39815c8ae10bdfec8b8`, branch `fix/booking-service-availability`, compared with frontend main `ffdc1bc`. Only the diagnostic script/workflow and task record changed; no application or runtime correction is proposed in this tree.
- Reviewed `scripts/booking-service-runtime-audit.cjs`, `.github/workflows/booking-service-runtime-audit.yml`, task record, Office facade/base handler, bootstrap/dependencies, reference readers, relevant Field/Project handlers and the Office deployment resource pin.
- Authorities remain unchanged: Identity/roles, Scheduling and capacity, canonical Contact/Customer/Property. Preserve `OPS-SCHED-SPOTS-001` and all existing transactional/recovery behavior. No migration or customer/appointment writes are in scope.

## Observed evidence

- Parent's initial probes from the workspace observed platform HTTP 503 without application CORS headers for Office OPTIONS and anonymous POST. Office normally sets CORS before facade handling; OPTIONS does not query customer records. A platform response therefore must not be treated as evidence that the application's CORS policy needs changing.
- Independently inspected final diagnostic run [38099173217](https://github.com/demac-aruba/demac-corporation/actions/runs/38099173217), job `114351331928`. At 2026-10-11 00:39:58 UTC, the GitHub runner received **429 without CORS** from OPTIONS to Office, Project, Field and Booking References. This confirms an availability failure from a second network and across four deployed functions.
- Office remains `ACTIVE`, revision `officebookingauthority-00082-dov`, Node 22, 256 MiB, CPU `0.1666`, concurrency 1, maximum instances 100, ingress `ALLOW_ALL`. Cloud Run reports Ready/ConfigurationsReady/RoutesReady true and 100% traffic to that revision. No manual-scaling annotation was returned. Readiness metadata does not establish successful request handling.
- Final Monitoring queries filter the exact Office revision and return `morePages:false`. The highest returned memory distribution **mean** is `0.729606628417967`; no per-sample maximum is available. Recent active and idle instance samples are zero, with earlier counts far below 100. Request counts include 500 responses around 00:25/00:27 and 429 from 00:33 onward; the largest returned one-minute 429 count is 16 and includes diagnostics. These samples do not demonstrate OOM or saturation of the configured instance maximum, and cannot exclude unsampled short-lived failures.
- Billing reports `billingEnabled:true`. Regional reported CPU and memory allocation limits are 200000 and 429496729600 respectively. The queried quota-exceeded series is empty. An `InstancesPerProject` quota metric reports zero, but its applicability to Cloud Run Services has not been established; it must not be used as proof that this service has an effective zero-instance cap. Empty or sparse quota series do not prove that every platform restriction is absent.
- Runtime logs were denied by the existing deployer account in run `38098705455`; the separate concurrent investigation also encountered denied logging access. No role or IAM policy was changed. Later diagnostic runs deliberately retain a failed audit result because the required runtime-error evidence remains unavailable.

## Findings

| Severity | Evidence and impact | Required disposition |
| --- | --- | --- |
| High | Cross-service platform rejection is confirmed, but the causative runtime/platform error is unavailable. | Block corrective merge/deployment until evidence identifies a bounded remedy. Do not substitute a memory increase, instance-limit change, source rollback or CORS edit for diagnosis. |
| High | Another chat is investigating the same deployed Office endpoint. Independent corrective deployments could overwrite each other or confuse incident evidence. | Coordinate one incident/release owner and retain exact revision/source checks before any eventual mutation. |
| Medium | Sampled means, readiness, billing status and empty quota series cannot establish the cause or prove runtime health. | Record their limits; do not mark the incident resolved or the audit passed because metadata and isolated tests are green. |
| Medium | Access to runtime error logs is blocked by existing permissions. | Prefer a sanitized log excerpt supplied by an already authorized Cloud administrator. Any new Logging/IAM grant requires separate explicit security approval; this investigation does not authorize it. |

## Verification and safety

- Diagnostic safety review: **PASS**. Commands are limited to function/service/billing describes, bounded Monitoring reads and OPTIONS against four fixed function URLs. The existing credential remains inside the runner; the access token is captured in-process and is never printed. Provider errors are suppressed, customer payloads and raw logs are not emitted, and numeric metric fields are allowlisted. Individual probe failures do not prevent later probes. No deploy, data mutation, message, billing change or IAM command is present.
- `node --check scripts/booking-service-runtime-audit.cjs`: PASS on the final script. An independent synthetic classifier check verifies memory categorization while omitting a supplied token/email from output.
- Independent local startup check: bootstrap loads 767 modules/112 exports at approximately 88–89 MiB RSS; facade construction plus 20 local OPTIONS/anonymous POST pairs remains stable. This used local Node 24 without production data/framework or a 256 MiB container limit, so it is not a production OOM reproduction.
- Builder reports **47/47 isolated Office catalog/master-data/auth tests passed**. These support existing authorized behavior and failure contracts; they do not verify live service availability.
- No application fix exists in this diagnostic tree. Full product regression or a production correction cannot be reported as verified. Reviewer performed no production writes, customer-data reads, deployment or credential/IAM changes.

## Decision

- [ ] Pass
- [ ] Pass with recorded follow-up
- [x] Block / changes required — incident diagnosis and corrective deployment remain blocked.

The diagnostic code is safe to run with its current read-only scope. **The service is not restored and no runtime correction is approved by this review.** The next evidence needed is the relevant Cloud Run runtime/system error or an authoritative platform restriction for the affected revision and incident window (approximately 00:20–00:45 UTC on 2026-10-11), obtained through an already authorized operator or an explicitly approved access change. Share only sanitized infrastructure error text, timestamp and revision; no tokens or customer records.

Owner: incident/release maintainer, coordinated with the concurrent investigation. Due: before any corrective merge/deployment or claim of restored service. Once the cause is established, review the smallest correction, run its applicable gates and verify actual-origin CORS plus authentication denial and service stability. Existing deployment authorization does not waive a separate security-approval boundary for new IAM access.
