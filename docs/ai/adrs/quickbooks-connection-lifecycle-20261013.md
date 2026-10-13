# ADR: Isolated, gated QuickBooks production connection lifecycle

- Status: Proposed; implementation reviewed, production activation pending.
- Date: 2026-10-13 UTC / 2026-10-12 Aruba.
- Owner: DEMAC integration boundary.
- Existing sandbox ADRs are preserved.

The verified sandbox connector remains untouched. A separate `quickbooksConnection`
HTTP function owns `integrationPrivate/quickbooksProduction` and its audit children.
These are provider authorization metadata, not a second financial ledger.

The first production capability authorizes one configured DEMAC company and reads only
CompanyInfo to verify its identity. It has no financial GET, transaction write, webhook,
CDC, background job or ChatGPT/MCP route. Activation requires an explicit server flag,
production-only secrets, a verified realm and one designated owner UID whose ERP admin
profile is freshly checked. This deliberately does not grant access to all ERP admins.

OAuth uses HTTPS, a fixed callback and return page, a random single-use state, encrypted
pending tokens, browser proof and an authenticated completion ticket. Connection
versions prevent stale disconnect requests from revoking a newer authorization.
Revocation serializes with OAuth; uncertain requests block reconnect until explicitly
retried. Page GETs and untrusted query parameters are never revocation authority.

URLs to publish after review:

- Host domain: `demac-aruba.com`
- Launch URL: `https://demac-aruba.com/integrations/`
- Connect/Reconnect URL: `https://demac-aruba.com/quickbooks/connect/`
- Disconnect URL: `https://demac-aruba.com/quickbooks/disconnect/`

The two standalone entry pages are outside public navigation and have noindex metadata.
They can be opened by anyone; authenticated connection state and actions require the
authorized owner. They do not claim that visiting the disconnect page revoked access.

Official references consulted 2026-10-13:

- https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0
- https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js
  (`revoke`: POST JSON `{token}`, Basic client authentication, official revoke endpoint).
- https://developer.api.intuit.com/.well-known/openid_configuration

Production configuration, approved deployment, real authorization/revocation acceptance,
Intuit policy review and country eligibility remain explicit rollout gates. Publishing
entry pages alone does not establish production readiness or enable accounting writes.
