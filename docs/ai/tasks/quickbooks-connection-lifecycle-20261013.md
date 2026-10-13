# Task: QuickBooks production connection entry points

## Context and scope

Christian requested implementation of the missing host/launch/connect/disconnect URL
capability after Intuit displayed Compliance 100% and App details 83%.
Deep Review applies: this touches authorization and credential lifecycle.

- Add standalone, noindex connect/reconnect and disconnect pages outside the public menu.
- Add an isolated production OAuth/CompanyInfo/revocation backend, disabled until
  production credentials, the verified DEMAC realm, and the designated ERP owner are configured.
- Keep the existing sandbox implementation and deployed function unchanged.
- No invoices, payments, expenses, inventory mutations, AI disclosure, financial reads,
  accounting synchronization, operational migrations or automatic activation.
- Save a reviewed PR and publish the disabled frontend using the owner's existing
  explicit merge/deploy authorization in this integration conversation. No credential
  configuration, backend deployment or real-company activation is included.

## Authorities and acceptance

Firebase Auth and fresh ERP profiles own identity. The existing integrationPrivate
boundary owns encrypted provider credentials; QuickBooks remains accounting authority.
FIN-QBO-SANDBOX-READ-001 is preserved. No Legacy parity or Firestore rule change.

- [x] URLs render with safe signed-out, unauthorized, disabled and failure states.
- [x] Sign-in returns only to the two QuickBooks pages and the Integrations launch page for ERP super admins.
- [x] OAuth binds configured company, owner, state, browser proof and completion ticket.
- [x] GET/landing-page visits never connect, revoke or erase credentials.
- [x] Disconnect requires explicit POST and a current connection version; races and
      uncertain outcomes fail closed and are visible, with no false success.
- [x] Secrets remain server-side, encrypted at rest; errors contain safe diagnostics only.
- [x] Targeted tests, existing sandbox regressions, Firebase validation, ERP type/build,
      browser acceptance and separate adversarial review pass.

## Recovery and verification limits

Rollback frontend to its prior deployment; leave production activation disabled. No
customer data restoration is necessary because no customer collections are changed.
Synthetic provider tests cannot substitute for the later owner-driven sandbox and real
DEMAC company verification. Production keys and the DEMAC realm are not yet available.
