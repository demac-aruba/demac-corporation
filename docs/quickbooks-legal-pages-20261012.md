# QuickBooks legal pages — internal-use publication

Mode: Fast Product Validation. Scope: two isolated static HTML documents only. They document the connector's current behavior; they do not change security policy enforcement or integration behavior. Base reviewed: main `6689c6f252f795828bbd5f4c7187c05311da2fce`.

The Intuit Production form is at 67% App details and requires a public EULA and privacy URL. The owner reviewed the purpose/visibility concern and on 2026-10-12 at 21:25 Aruba accepted publishing the necessary documents outside the commercial website navigation to generate the links Intuit needs. This authorizes publication of these documents, not real-company access, accounting writes or changes to the owner's declared country. The documents are not an assertion of production readiness, legal compliance or Intuit approval.

## Publication locations

- `https://demac-aruba.com/legal/quickbooks-terms.html`
- `https://demac-aruba.com/legal/quickbooks-privacy.html`

The draft notices are replaced with a prominent internal-use notice and an effective date. Both files retain `noindex, nofollow`, are absent from the site's sitemap and have no inbound links from its homepage, menu or footer. This reduces discovery; it does not create access control. Anyone with the URL can read the document. Do not block crawling in robots.txt: a crawler must be able to read the noindex directive. Verify unauthenticated HTTP/content on the actual domain before entering the URLs in Intuit. The `[merge-only]` marker keeps publication controlled until the reviewed head passes the applicable checks.

## Evidence and limits

- `functions/quickbooksSandboxService.js`: sandbox API only, explicit company match, active owner/admin authorization, encrypted server-side tokens, connection/audit metadata.
- `functions/quickbooksSandboxReports.js`: exactly three read-only sandbox reports; stored audit metadata excludes report values. Report values are returned transiently to the client.
- `apps/erp-next/lib/firebase/quickbooks-sandbox.ts`: browser session storage supports OAuth completion, and no ChatGPT/MCP connection exists in this connector.
- `functions/quickbooksSandboxHttp.js`: no ERP disconnect/delete route. Therefore no self-service disconnect or automatic data-deletion claim is made.
- No automatic retention expiry or completed privacy-request operation was evidenced. Wording discloses that limitation instead of inventing deletion periods. The manual request contact and data-use commitments are included in the documents presented to the owner before accepting publication.
- Business identity, commercial address and published sales contact come from the owner's provided business details.
- No GDPR certification, statutory retention period, third-party data-processing agreement, backup capability, service-level agreement, limitation-of-liability cap or live-data authorization is asserted.
- This is scoped to the QuickBooks connector. A policy for all ERP operational modules is a separate review.
- Current Intuit Developer Terms (dated 2025-10-14), especially section 8.6, require accurate disclosures of collection/use/storage/sharing, user consent, and appropriate handling of revocation and deletion: https://static.developer.intuit.com/output_html/tos/docs/tos.html . This draft does not attest compliance or replace implementation of the production requirements.

## Before completing the rest of onboarding

App URLs, production authorization, disconnect handling, deletion procedures and the Compliance questionnaire still need implementation/evidence where applicable. The sandbox callback must not be represented as a production connector. No QuickBooks accounting write, secret change or backend deployment is part of this change. The authorized frontend release publishes these two static documents only.

Country clarification: Intuit Developer Terms sections 4.1–4.3 require accurate domicile/entity information. Aruba is the owner's true profile country; United States remains the actual server hosting location. The portal's App Partner Program country notice does not independently establish that this Aruba internal integration will be accepted or rejected. An authoritative eligibility confirmation is still pending; no alternative domicile may be invented to bypass it.

## Verification

- Headless Chromium served both standalone pages over loopback HTTP without authentication at 1280px and 375px. Both returned 200; cross-links returned 200; no horizontal overflow, browser exceptions, external requests, scripts or forms.
- Screenshots of both pages at both widths generated; desktop terms and mobile privacy visually inspected. The local render required the already available `/tmp/chromium` executable because Playwright's default browser download was absent.
- Full new-file review and whitespace check: only these two static pages and this review note. No runtime code, credentials, backend, security rules or deployment configuration changed.
- Publication validation: `NEXT_PUBLIC_QBO_SANDBOX_ENABLED=true npm run build` passed, including all nine mandatory prebuild scripts, TypeScript and the full static export. Next.js regenerated two local configuration/type files; those automatic changes were inspected and restored so the release stays limited to the three intended files.
- The final exported HTML matches source byte-for-byte, has the internal-use notice and `noindex, nofollow`, and passes HTTP/mobile/desktop browser checks without external requests. The exported homepage and sitemap contain neither legal URL. No extra application suites were added for these static documents. Live hosting and Intuit acceptance must be reported separately.
