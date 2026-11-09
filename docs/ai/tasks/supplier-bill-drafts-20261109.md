# Shared supplier purchase drafts

## Context and scope

The owner requested continuation of the supplier-invoice workflow after accepting manual import rates, per-line overrides and configurable financial permissions. The existing editor only exports a JSON file. This delivery saves and reopens shared **operational drafts**, with server calculations, versioned history, exact retries and duplicate-reference checks. It does not receive stock, publish catalog prices, close imports, send QBO transactions or grant financial approval to operators.

## Governance

- Deep Review, Solo Maintainer Adversarial Review. ERP Next presentation; Functions owns draft persistence.
- Existing catalog, physical stock and QBO accounting authorities remain unchanged. Supplier names in drafts are unverified document labels, not a new supplier catalog.
- New private staging collections require an explicitly approved activation before live use. Backend defaults disabled. No security-rule or production configuration changes.
- Existing provisioned roles are checked inside transactions. Draft preparation is separate from the future configurable import/price/transfer confirmation rights for Christian, administrator and Yerika.
- ADR `supplier-bill-drafts-20261109.md` documents the proposed persistence boundary.

## Acceptance criteria

- Save, list and reopen multiple-line drafts with all manual rates and price selections preserved.
- Browser and server share one integer calculation implementation. Server stores its calculation snapshot and incomplete-line diagnostics.
- A concurrent edit rejects the stale version without overwriting work; successful saves append immutable revisions with actor/time and correction reason.
- Same request and payload replays the original result. Changed payload under the same request ID conflicts. Same supplier label/invoice reference cannot create a second draft without operator review.
- An interrupted save is retained privately for the same authenticated user and can be resolved after reload. A rejection receipt fences an old attempt from committing after rejection.
- Unknown/inactive roles and untrusted origins fail closed. No tokens in draft recovery or logs.
- Save changes no stock, catalog, bank or QuickBooks record.

## Verification plan

Focused service and HTTP tests, simultaneous transactions and retry/failure cases, existing five costing tests, frontend typecheck/build, isolated browser exercise, complete diff inspection and separately recorded adversarial review. No production reads/writes are needed for acceptance.

## Result

Implemented as a disabled feature-branch candidate. Nineteen focused tests passed (9 service/HTTP, 5 recovery/transport, 5 costing), along with typecheck, Functions validation, the full Next build and isolated browser save/reopen/conflict/recovery/read-only checks. See `../reviews/supplier-bill-drafts-20261109.md` for final review evidence and deployment limits. No production activation, catalog/stock/bank write, role grant or QBO send occurred. Next implementation stage is canonical supplier/item linkage and receiving through the existing Inventory Authority.
