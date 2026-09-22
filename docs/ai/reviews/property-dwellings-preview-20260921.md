# Review: Property dwellings preview

## Review mode
- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review
Implementation author and reviewer: Codex, separate adversarial pass after initial implementation. This is not an independent review.

## Scope
Compared the complete working diff against d1a495611f178210474f6fd40b84e514f614ba75 and read the active CRM, booking, contacts, lifecycle, Field/return visit, equipment and report callers. Existing Capacity/Booking, Property/Site, Contact and Field authorities remain intact. No production data or security rules were changed.

## Findings and corrections
| Severity | Finding | Correction/evidence |
| --- | --- | --- |
| High | Property-only A/C checks permit neighboring dwelling equipment | Exact dwelling check and transactional Area validation added to Field attach and registration; negative emulator tests. |
| High | A read-side Work Visit identity projection omitted dwelling, rejecting a valid newly prepared visit | Propagated dwelling through fieldOperationsVisitRead; real authenticated Field API, transition and Storage registration now pass. |
| High | An unsigned Auth Emulator JWT is not a public authentication boundary | Gateway accepts only password-issued tokens from its own session registry; forged/anonymous tokens denied; raw emulators remain loopback-only. |
| Medium | Agenda label and active mobile detail needed the new destination/parties, beyond storage changes | Agenda site now uses frozen destination; active technician arrival panel displays requester/access. Browser evidence verifies the public build. |
| Medium | Generic property assignment precedence could override a dwelling-specific contact rule | Explicit ordered precedence, shared in server and frontend; neighboring recipients excluded. |
| Medium | A successful master-data save followed by a failed refresh could look unsaved | Reuse stable request IDs/in-flight guard and retain returned canonical record in shared booking references. |
| Medium | Draft edits after an unknown location write could create a new operation | Lock the exact draft pending retry; replay the same request; browser offline-abort/retry passed. |
| Medium | Historical contacts could block rescheduling after later contact changes | Lifecycle availability validates location but retains historical party snapshots; neighboring-dwelling offers still rejected. |
| Medium | Public preview might use production frontend defaults | Exact demo project guard, same-origin Firebase gateway, built-bundle check, CSP, disallowed production project paths and no external workers. |
| Medium | Pushing a branch could trigger hosting automation | Branch-specific git.deploymentEnabled=false in both Vercel roots plus existing merge-only ignore marker. Production GitHub jobs restricted to main; no workflow_dispatch. |
| Low | Extremely large dwelling/contact batches exceed transaction limits | Explicit bounded batch rejection before writes; users can submit additional batches. |

## Verification
- ERP Next typecheck and optimized static build; mandatory prebuild checks passed.
- 549 backend regression tests passed after final location/lifecycle/VisitRead changes.
- 7 real Firestore-emulator integration scenarios cover A–E, G, I, K, L. Separate demo test project is reset; review preview data is retained.
- CRM, live scheduling, lifecycle, field domain, field security contracts and field experience acceptance scripts passed.
- Real browser desktop: existing property, explicit dwelling, different requester/access, 2-unit appointment without equipment, normal return to agenda; offline save retains exact draft and recovers.
- Chromium/Pixel 7 and WebKit/iPhone 13 emulation: 40-apartment search, booking modal and inline customer/property/dwelling creation, second session persistence.
- Real gateway/API: password sessions, technician office-write denial, anonymous/forged denial, production project/storage denial, direct database-write denial and external-send denial.
- Actual Field API + Storage: assigned technician, prepared/current visit, arrival, three distinct units (12000/12000/18000) in one area, Visit Assets and Professional Report location projection.
- Preview export/restart/import preserved all 162 Firestore documents, verified by count and canonical content digest; password sign-in and assigned Field API also passed after restore.
- No production migration, merge, deployment, message, invoice, security-rule or secret change.

## Requested acceptance evidence
| Case | Actual evidence |
| --- | --- |
| A | Emulator: existing house gains main house plus four apartments; old equipment document unchanged. CRM fixture is reopenable. |
| B | Configurable 23-dwelling batch; same synthetic owner also retains a second simple property. |
| C | 40-dwelling batch and mobile searchable selection. |
| D | Equal apartment codes in different properties succeed; normalized duplicate in one property is rejected. |
| E | Three physical IDs in one area, 12000/12000/18000 BTU, through authenticated Field and Storage APIs. |
| F | Desktop browser searches DEMO Test Lane 100 and explicitly selects Apartment 1 in the existing booking modal. |
| G | Distinct synthetic owner, requester and access contact preserved through appointment, Work Order and technician UI. |
| H | Android browser creates customer, two properties and a dwelling inside booking; CRM and second session find the canonical records. |
| I | Browser confirms a two-unit appointment before that dwelling has equipment. |
| J | Existing absent-dwelling fixtures plus added complex-property legacy reschedule/cancel tests. |
| K | Transaction replay, raced versions, duplicate rejection, guarded submits and browser aborted network save/retry. |
| L | Foreign chains/contacts/equipment rejected; anonymous/forged/technician office writes and production paths denied. |
| M | Booking capacity, holds, multihour work, lifecycle, cancellation, partial completion and Field regression suites pass. |
| N | Browser reload and second session retain data; actual emulator restart/import preserves document contents. |

The new Property dwellings integrity PR workflow runs the seven emulator scenarios against demo data only. Full physical-device testing and manual completion of every service/financial workflow remain outside this preview evidence: report context was verified through its real read projection and existing report/closure suites, without sending a report or invoice.

## Decision and residual risk
Pass for isolated preview review. Production activation remains blocked on explicit owner approval.
Physical iPhone/Safari and Android/Chrome devices were not available; mobile tests use browser engines and device emulation. The public Quick Tunnel is temporary and requires the host to remain awake; data is backed by local emulators with export/import and periodic local checkpoints, not browser memory. At most the interval since the last checkpoint can be lost on an abrupt host failure.

All legacy compatibility tests pass, but legacy UI rendering of new dwelling-specific records is outside this ERP Next implementation. Do not activate production dwellings until the operational rollout boundary is reviewed. Historical equipment reclassification and grouping of existing apartment-as-property records are intentionally not executed. Review again after owner feedback or rebasing onto newer scheduling/Field changes.
