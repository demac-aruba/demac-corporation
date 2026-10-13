# QuickBooks production connection rollout

Implementation is prepared, not activated. This does not authorize accounting writes.
The owner requested development on 2026-10-12 Aruba time and previously explicitly
authorized merge/deploy for this integration, conditional on protecting real QuickBooks
data. That authorization covers publishing these disabled entry pages after review.
Credential configuration, backend deployment and real-company activation were outside
the entry-page release. The later preparation status is recorded below.

## Owner-confirmed company and preparation status — 2026-10-13

- The owner supplied Company ID `9130 3523 2707 4466`; the exact server value is
  `QBO_PRODUCTION_REALM_ID=9130352327074466`. Preserve this as a string. This is the
  owner-designated target, not evidence of a completed Intuit authorization.
- The owner confirmed the real company subscription is **QuickBooks Advanced**.
  Subscription name does not establish the company's country edition or API eligibility.
- Production credentials have been unlocked. Metadata preflight run `38406692889`
  on merge `00090bb576f17a56fd6292358537b184dcf006e3` confirmed enabled version `1`
  for both `QBO_PRODUCTION_CLIENT_ID` and `QBO_PRODUCTION_CLIENT_SECRET`.
  Values were not accessed and Intuit has not validated them in a real authorization.
- The same preflight found no `QBO_PRODUCTION_TOKEN_KEY` and no production
  `quickbooksConnection` Function. Existing `quickbooksSandbox` was active on
  revision `quickbookssandbox-00002-meb`; no existing function was changed.
- The isolated source package is prepared with the designated realm and
  `QBO_PRODUCTION_ENABLED=false`. It is not deployed. The frontend gate remains off.
- Christian supplied his exact ERP sign-in address on 2026-10-13. Installation run
  `38418601440` verified that exact Firebase Auth identity and its matching active
  administrative profile before failing at key creation. Reverify both during the
  resumed installation before assigning `QBO_PRODUCTION_OWNER_UID`. The UID is not
  logged. Do not infer it from a GitHub author, company contact, another admin, or
  the Intuit login. Do not alter users, roles or passwords.

Diagnostic run `38419860300` then confirmed that the deployment identity lacked secret
creation/version-addition/IAM-write permissions, the encryption key did not exist and no
production function existed. Its optional audit query returned HTTP 400; no specific
audit event was established. The permission/metadata results independently identify the
missing preparation. Neither run made an Intuit request.

The owner's Cloud Shell screenshot at 2026-10-13 16:05 UTC shows creation of token-key
version 1, successful accessor grants for all three named production secrets and
`QBO_READY`. The approved bootstrap used a new random 32-byte key and scoped secret IAM
bindings for the verified existing runtime identity. No project-wide role was granted.
This is owner-supplied completion evidence; resumed cloud preflight must still verify
the existing labeled key and exact enabled versions. Do not create another key or rotate
credentials. A new reviewed merge resumes the original disabled installer from current
main because replaying the old run would correctly fail its stale-main check.

Next rollout work: verify the completed preparation, deploy only the isolated disabled
backend, verify its boundaries,
and complete the activation gates below. Real-company consent remains owner-driven.
The bounded installer and acceptance criteria are documented in
`docs/ai/tasks/quickbooks-production-installation-20261013.md`; its cloud result must be
recorded separately and must not be inferred from local tests.
No accounting writes, synchronization, financial-report access or ChatGPT access have
been enabled by supplying the Company ID or preparing this configuration.

## Publish the entry pages first

After approved frontend publication, verify HTTP 200, noindex, no public menu/sitemap
references, signed-out access, authorized sign-in return and the disabled production state.
Then enter these exact values into Intuit:

| Field | Value |
| --- | --- |
| Host domain | demac-aruba.com |
| Launch URL | https://demac-aruba.com/integrations/ |
| Disconnect URL | https://demac-aruba.com/quickbooks/disconnect/ |
| Connect/Reconnect URL | https://demac-aruba.com/quickbooks/connect/ |

A pending-activation page is intentional until Intuit provides production credentials.
It must not be represented as an already working production authorization. The screenshot's
URLs are landing pages, distinct from the OAuth Redirect URI below. The disconnect page
never treats an unauthenticated visit or query string as proof of revocation.

## Configure the isolated backend after keys become available

- Function entry point: `quickbooksConnection`, region `us-central1`, Node 22,
  maximum 3 instances, timeout 60 seconds.
- OAuth Redirect URI (Production):
  `https://us-central1-demac-corporation.cloudfunctions.net/quickbooksConnection/callback`
- Return page: `https://demac-aruba.com/quickbooks/connect/`.
- New Secret Manager references: `QBO_PRODUCTION_CLIENT_ID`,
  `QBO_PRODUCTION_CLIENT_SECRET`, `QBO_PRODUCTION_TOKEN_KEY` (32 random bytes, base64).
  Never reuse the sandbox credentials/key or paste values into a chat, source or logs.
- Server configuration: `QBO_PRODUCTION_ENABLED=false` initially,
  `QBO_PRODUCTION_REALM_ID` must be the verified real DEMAC Company ID (not sandbox),
  `QBO_PRODUCTION_OWNER_UID` must be the verified authorized ERP owner.
- Discover/deploy only the dedicated entry point with its two sibling modules and
  the existing Functions dependency manifest/lock, using an isolated source package.
  Do not deploy the root Functions index or update any operational function.
- Verify current deployment metadata/other-function inventory and approved source SHA
  before/after deployment. Do not access secret values merely to verify configuration.
- `NEXT_PUBLIC_QBO_PRODUCTION_ENABLED` stays absent/false until backend configuration
  and owner approval are complete. This is a UI gate; the backend enforces its own gate.
- Existing sandbox function, storage, scopes and report behavior are unchanged.

## Acceptance and limits

Synthetic tests cover owner authorization, company pinning, state/proof, explicit completion,
replay, overlapping actions, stale disconnect versions, revocation failure and local cleanup.
No real Intuit authorization or revocation has been performed for this change.

Before first real use, confirm DEMAC's actual QBO plan and country eligibility, review
Intuit security policies and questionnaire accuracy, update disclosures for actual production
use, and execute owner-driven authorization/disconnect/reconnect acceptance. A real-company
connection reads CompanyInfo only. Financial reports, synchronization and AI remain disabled.

A failed/uncertain revocation suspends local access and retains only encrypted credentials
for an explicit retry. It is not reported as successful. A configuration/key change with
existing credentials fails closed and requires controlled operator recovery. Keep the
configuration stable until disconnection completes. Provider-side disconnect can be done
from QuickBooks; the public return page alone cannot prove that it occurred.

Rollback: publish the previous verified frontend; keep both activation flags false. No
customer records or accounting data are changed by this implementation. After activation,
use the explicit revoke flow before removing credentials or retiring its backend. A full
process interruption immediately after Intuit issues tokens but before durable storage may
require revocation in QuickBooks; automatic external transactions cannot be rolled back.
