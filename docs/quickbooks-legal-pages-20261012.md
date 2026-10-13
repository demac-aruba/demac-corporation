# QuickBooks legal pages — owner review draft

Mode: Fast Product Validation. Scope: two isolated static HTML documents only. They propose legal/business wording; they do not change security policy enforcement or integration behavior. Base reviewed: main `6689c6f252f795828bbd5f4c7187c05311da2fce`.

The Intuit Production form is at 67% App details and requires a public EULA and privacy URL. These documents are drafts for approval, not an assertion of production readiness or legal compliance. Existing merge/deploy approval covered the sandbox connection/reports; it does not approve these newly drafted business commitments.

## Proposed locations after approval and publication

- `https://demac-aruba.com/legal/quickbooks-terms.html`
- `https://demac-aruba.com/legal/quickbooks-privacy.html`

Do not enter these in Intuit until owner approval, removal of the draft notice, final effective date, publication, and unauthenticated HTTP/content verification on the real domain. Keep this PR in draft until the text is approved. The `[merge-only]` commit marker suppresses automatic Vercel previews for this review draft; the standalone files are local review previews.

## Evidence and limits

- `functions/quickbooksSandboxService.js`: sandbox API only, explicit company match, active owner/admin authorization, encrypted server-side tokens, connection/audit metadata.
- `functions/quickbooksSandboxReports.js`: exactly three read-only sandbox reports; stored audit metadata excludes report values. Report values are returned transiently to the client.
- `apps/erp-next/lib/firebase/quickbooks-sandbox.ts`: browser session storage supports OAuth completion, and no ChatGPT/MCP connection exists in this connector.
- `functions/quickbooksSandboxHttp.js`: no ERP disconnect/delete route. Therefore no self-service disconnect or automatic data-deletion claim is made.
- No automatic retention expiry or completed privacy-request operation was evidenced. Wording discloses that limitation instead of inventing deletion periods. The owner must approve the proposed manual request handling, contact mailbox and stated data-use commitments.
- Business identity, commercial address and published sales contact come from the owner's provided business details; exact registered entity naming should be confirmed with the owner before publication.
- No GDPR certification, statutory retention period, third-party data-processing agreement, backup capability, service-level agreement, limitation-of-liability cap or live-data authorization is asserted.
- This is scoped to the QuickBooks connector. A policy for all ERP operational modules is a separate review.
- Current Intuit Developer Terms (dated 2025-10-14), especially section 8.6, require accurate disclosures of collection/use/storage/sharing, user consent, and appropriate handling of revocation and deletion: https://static.developer.intuit.com/output_html/tos/docs/tos.html . This draft does not attest compliance or replace implementation of the production requirements.

## Before completing the rest of onboarding

App URLs, production authorization, disconnect handling, deletion procedures and the Compliance questionnaire still need implementation/evidence where applicable. The sandbox callback must not be represented as a production connector. No QuickBooks accounting write, secret change or production deployment is part of this change.

## Verification

- Headless Chromium served both standalone pages over loopback HTTP without authentication at 1280px and 375px. Both returned 200; cross-links returned 200; no horizontal overflow, browser exceptions, external requests, scripts or forms.
- Screenshots of both pages at both widths generated; desktop terms and mobile privacy visually inspected. The local render required the already available `/tmp/chromium` executable because Playwright's default browser download was absent.
- Full new-file review and whitespace check: only these two static pages and this review note. No runtime code, credentials, backend, security rules or deployment configuration changed.
- No repository-wide application suites were needed for standalone static HTML. This verifies local drafts, not live hosting or acceptance by Intuit.
