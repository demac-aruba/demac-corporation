# Adversarial review — shared visual website editor

- Date: 2026-09-18
- Mode: Deep Review / Solo Maintainer Adversarial Review. This is a separate self-review, not an independent reviewer.
- PR: #513, feature/website-visual-editor
- Reviewed and tested application commit: `93af25af4c3a13728a9e3b4413fad12364d5e92d`
- PR base: `cb01c4696a3a35dbc23c9989bc54473fa67356b5`
- Result: functional isolated preview verified. **Full production feature is not ready for activation or represented as complete. No merge performed.**

## Scope inspection

Reviewed final changed-file inventory, actual editor launch/frame/overlay/workspace interaction, shared content allowlist and normalization, browser repository/recovery behavior, website-only Firebase service/adapter, inactive API entry, candidate rules, deployment triggers and retained operational readers. Inspected the full navigation corrective diff: workspace changes only the Return-to-VRF handler; frame-provider adds allowlisted client routing while top-level ordinary visits remain inactive.

The production Firestore/Storage rule paths, Firebase configuration and rules deployment workflow, operational functions bootstrap/package, Legacy source, operational calendar reader and root patcher now equal the PR base. The Git-based scope gate passes on the PR merge candidate. Root-rule deployments are not disabled: the PR no longer modifies the paths that trigger them. Candidate rule files remain separate emulator inputs. The website API is not exported by the operational bootstrap.

No operational backend function deployment, production data mutation, rules rollout or merge was executed during this review. The only application entry additions outside public VRF are the explicit Settings/Website Manager launcher and an editor-only logout revocation signal. Existing auth token storage, role mapping and operational writes are not replaced.

## Findings and resolutions

### Closed for isolated preview: automatic rule deployment coupling

The earlier PR placed proposed rules in automatically deployed root files and changed existing calendar readers to accommodate narrower settings access. This was incompatible with the owner's frontend-only/no-operational-disruption requirement. Those changes were removed from the delivered diff, not hidden by disabling tests or deployment jobs. Candidate rules retain all six allow/deny assertions in local demo emulators. Tests of the withdrawn scoped-reader refactor were replaced with tests of the actual retained reader behavior and exact source-preservation assertions.

### Closed: selecting a background intercepted CTA descendants

An editable hero/final-section image container can contain actionable links and nested spans/SVGs. Selection now checks the actual event target's interactive ancestors before selecting the editable container. A pointer click and descendant-event cases preserve the exact internal destination and query.

### Closed: WebKit errors during repeated editor-frame reloads

Expanded navigation tests failed with uncaught prefetch/chunk errors while native document navigation and the Return button repeatedly replaced the iframe. Better route readiness checks made the failure reproducible; no error assertion was removed. The corrective implementation uses the existing Next client router only inside the explicitly activated editing frame, including Return to VRF. Same-origin public-route checks and query/fragment preservation remain enforced; ordinary top-level visitors retain their original behavior. The unchanged strict error assertions now pass in both Chromium and WebKit.

### Verified: persistence is tested beyond an in-memory repository

The website-only Firebase adapter is used by the inactive API candidate and by actual local demo Firestore/Storage integration tests. Tests verify a saved draft survives a fresh service instance, saving does not publish, publication can be read anonymously with its exact ID/content, idempotent replay, draft-only restore, protected-field/role/version denials and unchanged operational sentinel documents. This proves emulator persistence, not live endpoint deployment or live Firebase permissions.

## Executed verification

All listed runs completed successfully on the tested application commit:

- TypeScript and web build validation: run `35399775038`.
- ERP Next CI: run `35399774846`.
- Performance Health Center: run `35399774790`.
- Existing VRF mobile/catalogue browser review: run `35399774837`.
- Website visual editor review: run `35399774781`.
  - Domain service/syntax checks passed.
  - Exact production/operational-source preservation passed.
  - Retained calendar-reader and client recovery tests passed before actual site build.
  - Candidate security rules: six tests passed, none skipped.
  - Actual Firebase adapter persistence: three tests passed, none skipped.
  - Original browser suite: eight grouped checks passed in Chromium/WebKit, zero JavaScript errors and zero attempted cloud mutations.
  - Additional navigation suite: ten grouped checks passed in Chromium/WebKit, zero JavaScript errors and zero attempted cloud mutations.

Browser artifact: `10569859100`, website-editor-browser-review. Both JSON reports and actual desktop/phone screenshots were downloaded and inspected. The screenshots show functional test edits, not published marketing copy. No physical Android/iPhone-device test or independent security review is claimed.

Vercel preview `dpl_FfBY9dGjmBSXcPchjKvFhb4VL897` is READY for the same application commit:
`https://demac-corporation-nyybgvoa9-demac-corporation.vercel.app/website-manager/`

The deployment is protected. Connector HTTP verification returned the Vercel SSO redirect, not an authenticated application page; READY and browser evidence must not be misreported as a successful authenticated live-browser session. The owner enters with their preview-host account and activates editing from Settings. Direct editor URLs intentionally do not activate editing.

## Remaining release blockers / limits

1. **Live publishing cutover is still pending.** Production UI defaults to disabled and the candidate publisher is unexported. A merge alone would not create a usable live editor. Do not tell the owner the full module is finished or silently enable it.
2. **Private draft permissions must be integrated without breaking operational settings reads.** Candidate rules intentionally demonstrate the narrow privacy boundary, but current operational clients still have collection-wide businessSettings reads. The candidate snapshots cannot be deployed unchanged while preserving those readers. Resolve the website-specific persistence/permission boundary before live activation; no deployment is authorized by this review.
3. Reconcile existing canonical draft/public content and generations, preserve the current website manager workflow during cutover, and test a specifically approved editorial publication via the authenticated live endpoint and an anonymous public result. Do not substitute browser-local Publish preview for this proof.
4. Static initial HTML/metadata remains the last build; hydrated VRF content reads the current published snapshot. Any SEO/HTML revalidation rollout is a separate explicit infrastructure decision.
5. Review drafts, uploads and history are tab-local and disappear on tab closure/reload. The UI labels this. Global header/footer editing and non-VRF page adapters are not implemented in this pilot; Careers is intentionally excluded.

## Engineering references checked

- Next App Router useRouter: https://nextjs.org/docs/app/api-reference/functions/use-router
- DOM event target: https://developer.mozilla.org/en-US/docs/Web/API/Event/target
- preventDefault and event propagation: https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault

## Disposition

The corrected review preview can be shown to Christian now. Keep the PR in draft and do not merge it as a completed production editor. The next implementation boundary is website-only live persistence/publication isolation, not another redesign of Scheduling/CRM/Dispatch or their permissions.
