# Careers administrative activation — 2026-09-09

## Request and scope
Christian showed the missing Management menu and requested continuing the administrative activation so he can prepare positions, profiles and forms. This follows the expressly approved Careers merges #494/#496. Production applicant intake is NOT authorized by this task.

Mode: Deep Review, because this includes deployment of the already-audited privileged authority. Baseline: e09578dfa45875366d64ffb9899937278accb3c0. Working branch: fix/careers-admin-access.

## Root cause and solution
The public menu was enabled but the internal Recruitment item still depended on an unset build-time NEXT_PUBLIC_CAREERS_ADMIN_ENABLED flag. Source merge also did not deploy Firebase's careersAdmin endpoint. Exposing a link alone would not make save work.

Make Recruitment a normal role-filtered Management entry, before Employees, restricted to the existing super_admin presentation role. The old admin visibility flag is no longer used; this supersedes that single line of careers-production-readiness.md. Add a page mount guard so data effects do not run until Firebase principal loading and authorization complete.

Deploy ONLY careersAdmin, reusing functions/careers.js and its audited service. The narrow staged entry exports one function. Resolve the existing runtime identity and provider-owned Firebase storage configuration. Reuse the existing repository deployment credential without reading/printing secret values or adding IAM roles. Browser reachability uses the same pattern as existing admin functions: endpoint ingress accepts HTTP, then Firebase ID-token revocation and users.active/users.role validation authorize every data request.

## Authority and safety
Existing Firebase Auth/users, functions/careers and the collections in ADR-CAREERS-001 remain authoritative. No new data model, duplicate service, direct-client write, role grant, owner impersonation or security-rule change. No changes to CRM, scheduling, Maya, projects, field, inventory or global style implementations.

The deployment enables DEMAC_CAREERS_BACKEND_ENABLED on this function only, forces CAREERS_RELEASE_APPROVED=false and CAREERS_RETENTION_APPROVED=false, and permits exact established website origins. No careersPublic or careersMaintenance deployment, SMTP secret setup, email send, scanner provisioning, live vacancy publication, candidate upload or sample production record. Existing domain rules allow Draft persistence but block Open status and intake until verified setup.

## Acceptance and verification plan
- Recruitment visible exactly once under Management before Employees for super_admin, with no accidental role widening and no dependence on public activation.
- Non-authorized/inactive principals never mount the data workspace; server authorization unchanged.
- Drafts and role questions persist across service instances with sender/scanner/privacy unconfigured. Exact retries retain identity; unauthorized roles fail; Open publication fails without altering saved draft; no operational records or emails.
- Existing ERP, Careers interface/history and backend suites remain mandatory. New release tests cover malformed project metadata, missing bucket, and refusal to overwrite a live-approved runtime.
- After main merge: normal Vercel rebuild; narrow Google Cloud deployment ACTIVE; CORS exact origins; missing/invalid token 401 and foreign origin 403. These checks do not impersonate the owner or write production test vacancies.
- First authenticated owner-session save must not be claimed verified unless actually executed. Browser/emulator checks do not certify physical Apple/Galaxy hardware.

## Recovery
Pause admin availability by disabling DEMAC_CAREERS_BACKEND_ENABLED on the admin function if necessary; retain data. UI reversal is this scoped menu/mount change. Never roll back the committed-file ownership repair or the public Careers navigation from previous PRs. Do not rerun this admin-preparation deployment over an already live-approved function.
