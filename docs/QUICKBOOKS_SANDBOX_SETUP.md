# QuickBooks sandbox connection — prepared, not activated

This is the first connection step for issue #385. It does not sync accounting or enable
ChatGPT access. No actual company is connected by this code delivery.

## Intuit setup

Keep the existing **DEMAC ERP** application. Use **Development** credentials only. In the
app's redirect URI configuration register this exact proposed Firebase callback:

```text
https://us-central1-demac-corporation.cloudfunctions.net/quickbooksSandbox/callback
```

This route is implemented in the feature branch; it will not respond until the Function is
approved and deployed. It is not the OAuth Playground redirect. Leave webhooks unconfigured
for this phase. Request accounting only; do not add the payment OAuth scope.

The operator screenshot identifies **Advanced Sandbox Company US c251**, realm
`9341458478454738`. Reconfirm this string in Intuit before configuring it; never coerce it
to a JavaScript number. This is not the real DEMAC accounting company.

## Managed configuration — owner approval required

Store these **server-only secrets** in the existing Firebase / Google Secret Manager project
`demac-corporation`, using a secure input channel. Never paste them into chat, source, a PR,
browser code, screenshots, logs or `NEXT_PUBLIC_*` variables.

| Secret | Source |
| --- | --- |
| `QBO_SANDBOX_CLIENT_ID` | Intuit app Development credentials |
| `QBO_SANDBOX_CLIENT_SECRET` | Intuit app Development credentials |
| `QBO_SANDBOX_TOKEN_KEY` | Fresh cryptographically random 32 bytes encoded as standard base64; retain in managed secret storage |

Server environment on the new Function:

| Variable | Proposed value |
| --- | --- |
| `QBO_SANDBOX_ENABLED` | `true` only after approval; otherwise disabled |
| `QBO_SANDBOX_REALM_ID` | `9341458478454738`, after operator reconfirmation |
| `QBO_SANDBOX_RETURN_URL` | `https://demac-aruba.com/integrations/` |

Firebase supplies `GCLOUD_PROJECT`. The Function derives its callback from that project,
not from request headers. Match the exact callback registered with Intuit.

The ERP deployment uses `NEXT_PUBLIC_QBO_SANDBOX_ENABLED=true` only after the Function is
ready. This is a public feature flag, never a credential. Its default is off. Do not enable
it in an isolated preview; preview calls are intentionally blocked.

## Bounded release and owner verification

1. Review the feature diff and automated evidence. Obtain explicit approval for new managed
   secrets, the new Function, and the ERP production deployment; `AGENTS.md` requires it.
2. Provision secrets without displaying their values. Keep the encryption key version needed
   for existing encrypted grants; do not rotate it blindly. A future rotation needs a
   reviewed re-encryption or disconnect/re-authorization procedure.
3. Deploy **only `functions:quickbooksSandbox`** from reviewed source/configuration to the
   existing Firebase project. Do not bulk-deploy legacy Functions, run migrations, change
   rules or modify IAM grants as an incidental step. Capture prior configuration for recovery.
4. Release the ERP card via the existing **demac-corporation-web** Vercel project, serving
   **demac-aruba.com**. Verify the reviewed commit and flag; no alternate domain defaults.
5. As an active admin/owner, open `/integrations/` and choose **Conectar sandbox** in the same
   tab. Select the US Advanced sandbox in Intuit, review consent, authorize, and return.
6. Confirm displayed sandbox name and exact realm, verification timestamp, and the explicit
   **sin movimientos contables** state. Compare to Intuit. Confirm one connected audit event.
7. Exercise cancellation and a second attempt. Do not connect the actual DEMAC company or
   use production credentials. If the wrong company is selected, the backend must reject it.

Do not label the integration live or the real DEMAC company connected until that actual
round trip has been observed. Stored metadata is a historical verification, not a health
probe. Access-token refresh and long-term revocation handling are not implemented here.

## Recovery and follow-up

- A lost finish response can be retried with **Consultar estado / reintentar** in the same
  browser session. Replayed callbacks or missing browser proof require a fresh authorization.
- If an exchange's outcome is unknown, do not replay its code. Start a fresh authorization
  after the attempt expires (ten minutes). No old connection is overwritten on failure.
- Disable both feature flags and restore reviewed prior ERP deployment to pause. The backend
  switch blocks provider activity but **does not revoke** the Intuit grant. Revoke the test
  app's grant in Intuit if disconnecting permanently; confirm the target is the sandbox.
- Pending credentials remain encrypted in one bounded record until a new attempt replaces
  them. Configure a reviewed retention/cleanup policy before routine use; never apply TTL to
  the connection document itself. Audit growth is bounded operationally by setup-only use.
- Owner/maintainer monitors safe error codes, setup rate and callback failures. Do not enable
  application request/body tracing on these endpoints; redact callback query parameters from
  any log export. Expected usage is fewer than ten setup attempts/day, not batch traffic.
- Before production sync: confirm the actual DEMAC realm, locale/currency/taxes, approved
  cutoff and mapping of existing records; implement serialized refresh rotation, disconnect,
  idempotent writes, webhooks/reconciliation and accounting acceptance. Then implement a
  separately authenticated read-only ChatGPT/MCP surface. No historical import is implied.

## Sources checked

- [Intuit OAuth JavaScript client](https://github.com/intuit/oauth-jsclient) — official OAuth endpoints and flow.
- [Intuit PHP SDK CompanyInfo fixture](https://github.com/intuit/QuickBooks-V3-PHP-SDK/blob/master/src/Utility.Test/XmlObjectSerializerTest.php) — entity `Id` differs from realm.
- [Intuit sandbox documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes) — test company environment.
