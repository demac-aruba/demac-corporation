# Review: PR570 dwelling communication correction

## Open production follow-up — 2026-10-12
Read-only run 38318497303 subsequently confirmed successful log access and zero matching reference-update errors from 21:31 through 22:46 UTC; the prior post-grant denial cleared without more permission changes. Administrative history confirms creation on October 7 but the returned records do not yet establish the historical service-level scaling setting. Extend inspection to matching System Event records, one Cloud Asset historical resource (read only, no API enablement or grant), and timestamp-only error checks across all five affected services. Failed/unavailable historical lookup cannot justify a capacity change. Fresh separate self-review checked exact resource/time bounds and numeric/scaling-only output; no production write or source change is present.

After the owner saved Logs Viewer, read-only rerun job 115040090306 confirmed both logging.logEntries.list and logging.logs.list are granted (testIamPermissions HTTP200), but the CLI log read still failed. Extend diagnostic-only inspection to a bounded direct entries.list timestamp request with structured error reasons, and this one service/function's Admin Activity scaling history. Fresh separate self-review confirmed the direct request uses the same principal/project, grants no access, returns timestamps only, and exports only allowlisted scaling values from administrative records. It does not bypass a denial or change production; unexplained read denial remains blocking.

The previous attempted restoration failed: run 38313992739 completed the single-field API operation but the next read still showed maxInstanceCount=20. Run 38313989757 verified all five reviewed application sources and IAM policies; the final log query was denied. These failed gates remain open.

Fresh Solo Maintainer Adversarial Review of the diagnostic-only extension: inspected all changed lines and the invoking task-branch workflow. Reads include prior/current revision annotations, service/template scaling and traffic, active account, caller permission introspection and log timestamps. The testIamPermissions POST grants nothing. No deployment, IAM mutation, database/messaging client or automatic recovery is present. Scaling values have a strict key/value allowlist; credentials, environment values and log bodies are never printed. Log denial, errors or result truncation keep the diagnostic incomplete. Node syntax, whitespace and existing release/configuration guards are required; live read-only evidence remains pending. Earlier spec-only comparison is insufficient to establish identical effective scaling, so no production capacity change is justified from that comparison alone.

## Review mode
- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review
- Implementation and separate review: /root. This is not an independent review.
- Owner explicitly requested Deep Review and conditionally authorized publication on 2026-10-12.

## Scope reviewed
Full PR diff, canonical location creation/snapshot, Work Order projection, notification service/trigger, manual communication authority, daily queue, same-day/support alerts, reference-update trigger and transactional queue; current main payment update PR571. Existing authority matrix, CRM-LOCATION-001, OPS-SCHED-REFERENCES-001, COMMS, role/recipient/legacy boundaries.

## Findings
| Severity | Evidence / impact | Resolution |
| --- | --- | --- |
| High release risk | Generic transactional workflow migrates old queues and realigns van groups; unrelated to this correction and violates the no-data-change release scope. | Dedicated source-only release; merge-only marker prevents generic deployment. No migration or queue sender is called. |
| Medium release gap | notifyBookingReferenceUpdate imports the changed daily formatter; omitting its deployment would leave attachment-update messages inconsistent. | Include this fifth existing function in bounded audit/release. |
| Medium integration risk | main advanced to payment overview PR571. | Integrated current main without conflict; CI on the combined source required. |
| Medium deployment drift risk | Functions may run different dependency/source generations; replacing all source from main can silently introduce unrelated backend behavior. | Download versioned live source, apply only reviewed text hunks + pure helper, preserve lock and every other file; test the candidate from each actual archive. Unknown/conflicting patches block release. |

| High release risk | Office source had no lock and its immutable image/cache could not be recovered. | Original exact-recovery gate failed; owner subsequently authorized a new fixed dependency baseline, with original/candidate regression and verified recovery archives. This does not recover the lost versions. |
| Compatibility | The new helper initially accepted only string addresses, unlike the previous notification coercion. | Preserve the original coercion and fallback, with queued confirmation/reminder regression cases for numeric and blank legacy addresses. |

## Verification and invariants
- Local syntax gate passed; 239 booking/lifecycle/reference tests, 133 transactional tests and 14 release/configuration tests cover the final implementation. Node22 CI must confirm the final head before merge.
- Shared formatter is pure, selects four display fields and performs no reads/writes/network calls. 50,000 local formatting iterations: maximum batch average 0.00397 ms/message; this is a microbenchmark, not a production latency claim.
- No frontend requests, rendering, loading state or save path added. Existing asynchronous queue/background dispatch and authoritative success/error state remain intact.
- Snapshot precedence and absence cases, exact retries, language/recipient preservation, private-field omission, neighboring-unit/other-appointment rejection and support/reference sequence tested.
- No rule, permission, role, trigger eligibility, recipient list, idempotency key, work/financial mutation or actuals path changed.
- The isolated Firestore suite passed all 11 scenarios, including canonical booking → persisted location → confirmation/reminder preparation and later dwelling rename. Actual live-source candidate audits are required in the dedicated workflow before a release decision.
- Actual authenticated production delivery is deliberately not tested: owner prohibits production writes and customer messages. Successful preparation in isolated queues does not prove external WhatsApp delivery.

## Decision
- [ ] Pass
- [x] Pass with recorded follow-up: exact final-head CI and repeated release preparation remain mandatory publication gates
- [ ] Pending technical review

Runtime artifact records before/after versions, source hashes, configuration/IAM preservation, scheduler and actual-domain boundary results. Deployment is blocked until critical evidence passes. Rollback preserves all operational customer/cita/queue records; see task recovery plan.

## Reconstruction review continuation
Owner approved the proposed isolated rebuild and recovery preparation after being told that exact prior dependency preservation is impossible with the accessible artifacts. The earlier runtime gate remains failed historically; resolution now requires the explicitly approved reconstruction checks, not waiver of that gate.

Verified reconstruction audit: run 38307339610 on b9d3fdf302a1d3bffaac4e8d0f60f244d051475e passed on Node22. Original/candidate counts: Office 503/514, confirmation 47/58, reminder 6/15, daily technician 28/30, reference updates 28/30. These are executions across distinct live-source bundles, not a count of unique test cases. All five bootstraps, dependency installs, reverse-patch equality and archive extraction comparisons passed. Recovery artifact 11773306089 was successfully uploaded; evidence artifact 11773291023 records source/configuration/IAM hashes, preserved schedulers and real-domain boundaries. No production deployment occurred in that audit.

Fresh separate adversarial self-review completed after reconstruction: inspected the full source/workflow/test diff, actual-source patch scope, linked-appointment identity, null/mismatch/legacy behavior, privacy allowlist, recipients and exact retry keys, test isolation, all-five pre-write validation, expected-head/main leases, archive integrity and partial-rollout recovery. Each historical bundle is required to export its own deployed function; all five are checked across their respective bundles. No application workflow is duplicated. The numeric-address finding above was resolved and locally verified; the final head must repeat CI and all five source audits before publication.

Residual evidence/limits: npm audit reports zero high/critical and nine moderate entries deriving from the uuid v3/v5/v6 supplied-buffer advisory; inspected consumers use v4() without a buffer. This is a recorded dependency advisory, not a claim that the dependency tree has no findings. Office recovery restores the prior application code with the new tested lock, not the unavailable old dependencies. Managed buildpack/OS identity is outside the application lock. No authenticated production booking or external WhatsApp send was exercised; isolated persistence/message preparation and non-destructive live probes are the permitted evidence. No material unresolved code finding remains; failed final CI, source drift or deployment verification still blocks completion.

No independent agent review was performed. Actual WhatsApp delivery and real customer writes remain outside verification by owner instruction.

## Packaging verification correction after partial rollout
Run 38308594583 completed preparation and uploaded original recovery artifact 11774320564 (all ten downloaded archive checksums verified). Office revision 00083-loq and confirmation revision 00046-taz passed published-source/configuration/IAM checks. Reminder deployment then stopped on `Published source differs: .gitignore`; no later function was deployed by that run. The run remains recorded as failed.

Google Cloud documents that its generated ignore policy excludes `.gitignore` itself: https://docs.cloud.google.com/sdk/gcloud/reference/topic/gcloudignore. The correction allows only the absence of this top-level packaging file; if present its bytes must still match. Every application/dependency file remains mandatory, and unexpected published files now fail verification. Synthetic tests cover omitted metadata, altered metadata, changed/missing application/lock files and injected extra files.

The resumed audit additionally pins all five complete candidate application manifests to SHA256 values calculated from original verified recovery artifact 11774320564, excluding only the two top-level packaging control files. This verifies already deployed functions against the original reviewed packages and prevents silently accepting unrelated source changes. Full Office regression/emulator checks are retained even on a resumed deployment with the now-present lock. Existing idempotent resume skips deployments whose exact patch/helper are already present, then rechecks their published source/configuration/IAM.

Fresh separate adversarial self-review of this follow-up found no application, dependency, trigger, scheduler, permission or data-write change. Fifteen release/configuration tests passed locally. Read-only live-source audit on the new exact head remains mandatory before resuming. Keep original recovery artifact 11774320564 for pre-update rollback: a later resume artifact's baseline can already contain this update. No failed gate is relabeled as passed.

## Confirmed maximum-instance restoration
Resume run 38310446182 verified the first four published functions, including daily technician revision 00042-laz, then stopped on a configuration mismatch after deploying notifyBookingReferenceUpdate. An initial retry-policy hypothesis was explicitly rejected by read-only run 38311863350; it is not the cause and no retry-restoration write occurred.

Read-only diagnostic runs 38312476955 and 38312663741 proved that revision 00002-wod retains RETRY_POLICY_RETRY and the prior Cloud Run revision spec (apart from the new code image). Removing only the newly materialized serviceConfig.maxInstanceCount=20 from the current function description reproduces the exact original full configuration hash 956adcd5f88a66e4c349347e5f6fe667b59cf2b25d9bec73c440f646511af662. No other field differs. The reviewed correction explicitly passes --clear-max-instances for this function to restore its original unspecified maximum, and --retry to preserve its existing enabled retry policy. The Google Cloud CLI documents clear-max-instances as zero/no explicit maximum for gen2: https://docs.cloud.google.com/sdk/gcloud/reference/functions/deploy.

All five original configuration and IAM hashes remain pinned to original recovery artifact 11774320564. A corrective plan is allowed only for this named function with maxInstanceCount=20, retry still enabled, and full original-hash equality after removing that sole field. Other field changes, other limits, disabled retry or other targets block. Already-applied code does not suppress required scaling restoration. Every original configuration/IAM hash and all reviewed application files must match after the write. No other configuration flag, permission, scheduler, data write or message replay is introduced. Read-only error-log timestamps are counted for the deployment window; any observed error requires investigation without automatic resend.

Fresh separate adversarial self-review inspected the complete corrected tooling diff, actual diagnostic evidence, full-config proof, prepared-plan equality, mandatory restoration despite already-applied code, postcondition equality and non-replay behavior. Sixteen local release/configuration tests passed, including negative cases for another changed configuration field, different limit, wrong target or disabled retry. Production closure remains pending exact-head read-only audit and controlled restoration. Original recovery artifact 11774320564 remains the pre-update source; recovery of notifyBookingReferenceUpdate must explicitly preserve --retry and --clear-max-instances. Diagnostic artifacts expose only safe metadata/hashes, never credential values or customer log payloads.
