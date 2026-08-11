# ERP Next — Site Access Readiness V1

## Objective
Replace the manual `Site Access` readiness toggle with an explicit Work Order Access Plan so crews do not arrive without a confirmed way to enter the property.

## Requirements

- **ACCESS-RDY-001** Site Access is resolved per Work Order, not assumed from a generic customer/property note.
- **ACCESS-RDY-002** Existing CRM property access text is contextual evidence only and cannot automatically produce READY.
- **ACCESS-RDY-003** Access Plan supports customer/contact present, open access, security/front desk, key/lockbox, gate/credential and other controlled access.
- **ACCESS-RDY-004** No Access Plan or `not_checked` status → AT RISK.
- **ACCESS-RDY-005** Explicit blocked access → BLOCKED.
- **ACCESS-RDY-006** Key/lockbox or gate/credential methods require secure credential availability to be confirmed.
- **ACCESS-RDY-007** Required credential marked missing → BLOCKED.
- **ACCESS-RDY-008** Required credential not securely confirmed → AT RISK.
- **ACCESS-RDY-009** The browser Access Plan stores only credential availability state; it must not store actual gate codes, lockbox codes, passwords or similar secrets.
- **ACCESS-RDY-010** Customer-present access without an identified on-site contact → AT RISK.
- **ACCESS-RDY-011** Confirmed access satisfying method-specific requirements → READY.
- **ACCESS-RDY-012** Access Plan may store operational contact name/phone and non-secret instructions.
- **ACCESS-RDY-013** Work Order Job Readiness no longer exposes a manual Site Access override after this module becomes authoritative.
- **ACCESS-RDY-014** Site Access participates in consolidated READY / AT RISK / BLOCKED and the AT RISK risk signature.
- **ACCESS-RDY-015** Changes to saved access facts may invalidate a prior AT RISK release for future Field start.
- **ACCESS-RDY-016** Historical releases and Field starts remain unchanged after later access-plan changes.
- **ACCESS-RDY-017** Work Orders expose the Access Plan near material/readiness planning so Operations can resolve access before dispatch.
- **ACCESS-RDY-018** Production migration should handle sensitive access credentials through a dedicated role-protected secure mechanism rather than general notes.
- **ACCESS-RDY-019** Production changes require authenticated actor/timestamps and append-oriented audit history.
- **ACCESS-RDY-020** Access confirmation is operational evidence and does not replace customer appointment confirmation.

## Decision hierarchy

1. Missing / not checked → **AT RISK**.
2. Explicit blocked → **BLOCKED**.
3. Credential-required method + credential missing → **BLOCKED**.
4. Credential-required method + secure availability not confirmed → **AT RISK**.
5. Customer-present method + no on-site contact → **AT RISK**.
6. Confirmed method-specific access → **READY**.

## Security guardrail

Do not store actual gate codes, lockbox codes or access passwords in the browser Work Order Access Plan. V1 records only whether required credentials are available through an approved secure method.

## Current data mode
Browser-persistent Work Order access plans plus read-only CRM access context. Production migration requires authenticated access events and a dedicated secure mechanism for sensitive credentials.
