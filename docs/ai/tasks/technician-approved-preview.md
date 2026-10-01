# Technician App: approved hosting path and current blocker

## Scope and authority
Owner request: continue the existing portal and provide a working review URL in DEMAC's existing GitHub/Vercel/Firebase-Google Cloud environment. Cloudflare tunnels are explicitly not approved. Do not restore them, rerun their historical workflows, or hide them behind a Vercel rewrite. Keep PR 526 Draft; preview review is still a prerequisite to merge/production.

Infrastructure consistency is a Deep Review boundary. This checkpoint is limited to a read-only inventory and a build-time guard. It does not introduce a domain database, authentication provider, change production access or publish a replacement preview.

## Observed infrastructure, not assumptions
Read-only run `36028452071`, source `9623df6441f84078e33b0f061d0edacb2da2e0b6`, authenticated successfully using the Google identity already configured in the repository. At 2026-09-24T16:36:10Z, its metadata GETs returned:

- Visible DEMAC project: `demac-corporation`.
- Firestore databases: `(default)` and `demac-restorecheck-20260921`.
- Preview-named Cloud Run candidate: `officebookingauthoritypreview`.
- No HTTP failures in this inventory.

These are only resources visible to that identity and matching DEMAC. A name containing preview or restorecheck does **not** prove synthetic data, isolated Auth/Storage, a Field backend, or permission to reuse it. Neither database nor the candidate service has been used for Field test writes. No customer documents, users, IAM policy, secret contents or environment values were queried. The workflow has no source checkout or product imports while authenticated; credentials are cleaned up by the authentication action.

Vercel's connector confirmed existing projects `demac-corporation-web` (`prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7`) and `demac-corporation` (`prj_gPKFUmmlG0KzQ0rW9lxUHMde165x`). The metadata get_project action currently returned a schema error asking for idOrName despite the exposed projectId parameter. Deployment reads work. This is not treated as an account-permission refusal.

## Guard integrated into Next configuration
`next.config.ts` has production Firebase fallbacks. Simply removing `[merge-only]` and obtaining a Vercel URL could therefore compile a preview against the live project. The new build check runs before resolving those fallbacks, only when Vercel builds `feature/technician-app-20260923`:

- Preview target only; the task branch cannot publish as production.
- Explicit test project selector `DEMAC_FIELD_PREVIEW_PROJECT_ID`; no production or `demo-` emulator project as a hosted service.
- Explicit, consistent NEXT_PUBLIC Firebase project, default Auth domain, project-owned Storage bucket, app ID/project number and app key; reject the known production defaults.
- Explicitly disable the loopback adapter for real hosted Firebase and disable production telemetry/analytics.
- Throw without logging configuration values; never rewrite environment variables or provision infrastructure.

Unrelated branches, production main and loopback CI are unchanged. Custom Auth domains or buckets are not silently accepted by this initial check: those need deliberate project verification rather than a suffix loophole. CLI deployments lacking Git branch metadata are outside this guard and are **not authorized as an alternative**; they still require the approved deployment/verification path.

A passed configuration guard is not proof of backend permissions, trigger isolation, service availability or functioning login. The existing public-preview gate remains blocked until actual authenticated Vercel checks pass. No test or gate is waived.

## Required completion before sharing another URL
1. Confirm a separately provisioned, owner-approved Firebase test project (or approve provisioning one inside DEMAC's existing Google Cloud account). Do not repurpose a restore-check database or the production default by inference.
2. Configure Auth, private Storage, Firestore and the existing Field/Office APIs for synthetic identities/data only. Exclude transactional senders, invoice/stock consumers and production secrets. Verify exact runtime identities and destinations.
3. Configure only this branch's Preview variables in the existing DEMAC Vercel project and deploy without merge. Do not alter production settings or another team's preview.
4. Exercise login, shared assigned work, service persistence, reload, private evidence and denied unauthorized access on the actual Vercel URL; inspect browser screenshots. Only then replace the blocked-preview gate with verified success and share that URL.

No test-project creation, billing link, new identity/secret, production configuration or deployment was performed in this checkpoint. Resource provisioning is an outstanding explicit decision, not a claim of missing user credentials.

## Verification and review
- Inventory workflow: YAML/bash/Python syntax inspected; remote authentication and allowlisted metadata GETs completed successfully. Only sanitized metadata retained.
- Build guard: local executable TypeScript regressions cover accepted synthetic configurations, both project-owned bucket formats, production/main/other-branch compatibility, missing settings, project/domain/bucket mismatch, production and emulator fallback, malformed app IDs, telemetry and no mutation of input. Tests are imported into the existing Field experience acceptance entry point; original tests remain intact.
- Next config integration: compile/evaluate the old/new configuration in a clean child process for main and unrelated preview branches; compare outputs. Task branch without explicit test config must fail before exposing defaults.
- Repository CI/typecheck/build for the new source must be recorded after completion, not inferred from these local checks.
- A separately performed Solo Maintainer Adversarial Review (not independent) must cover the full checkpoint diff, affected Next loader/CI callers, no publication side effects and error-message redaction.

## Remaining product scope
The earlier login/Home/Agenda/Profile/job context and embedded service cards remain. No new UI screen is claimed here. Full-screen flow, shared indoor/outdoor selection, 14/9 procedure capture, scoped helper writes, shared safety/concurrency, persistent multimedia outbox and full anomaly/add-on/closure/review remain pending.

Rollback of source is reversible; no data migration is involved. Do not remove the guard or restore an external publisher to make a deployment succeed without resolving the hosting and isolation requirements.
