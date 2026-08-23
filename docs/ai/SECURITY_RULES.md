# Security Rules

1. Never commit or print secrets, private keys, tokens, production credentials, or
   unredacted customer/employee data. Use managed secret stores and placeholders.
2. Authenticate every privileged endpoint and authorize the requested action server-side.
   CORS and hidden UI controls are not authorization.
3. Use least-privilege roles and service accounts. Separate operational, financial,
   administrative, deployment, and audit capabilities.
4. Validate and normalize all client, AI, webhook, file, and provider input. Enforce
   size, type, ownership, state-transition, and business-rule constraints.
5. Verify webhook authenticity where supported and apply replay protection/idempotency.
6. Keep Firestore and Storage rules synchronized with data access. Test allow and deny cases.
7. Minimize personal data in logs and AI context; use opaque IDs and structured redaction.
8. Encrypt in transit, use provider-managed encryption at rest, and avoid public storage.
9. Audit high-impact reads and writes with actor, authority, target, time, correlation ID,
   and outcome. Audit records must not contain secrets.
10. Fail closed when identity, role, authority, rule version, or provider verification is
    unavailable. Surface a safe recovery path without exposing internals.
11. Dependency, runtime, or security-rule changes require review and targeted regression tests.
12. Security exceptions require owner, rationale, compensating control, and expiration date.

## Human-controlled operations

Explicit human approval is mandatory before destructive database/data migrations,
production deployments, Firestore/security-rule access changes, secret or credential
changes, irreversible operations, production-data deletion, or creation of a new system of
record/source of truth. These actions must also have scoped targets, recovery planning where
possible, and audit evidence. Automated approval or another agent's assent is insufficient.
